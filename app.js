// ============================================================
// SafeZone — Core Application Logic (API-Powered)
// ============================================================

let map, heatLayer, selectedMarker, routeLayer;
let routeAlternativeLayers = [];
let emergencyLayerGroup, cameraLayerGroup, propertiesLayerGroup, riskLayerGroup;
let currentHour = new Date().getHours();
let layerState = { heatmap: true, cameras: true, emergency: true, properties: true, risk: true };
let currentMapCenter = MAP_CENTER;
let lastFetchedServices = null;
let lastFetchedCameras = [];
let lastFetchedProperties = [];
let lastAreaInfo = null;
let lastRiskData = null;
let isFetching = false;
let hasApiErrors = false;
const SCAN_SOFT_DEADLINE_MS = 6000;
const SCAN_CALL_TIMEOUT_MS = 9000;
let activeScanRequestId = 0;

const FAVORITES_STORAGE_KEY = 'safezoneFavorites';
const CONTACTS_STORAGE_KEY = 'safezoneEmergencyContacts';
const MAX_FAVORITES = 40;
const MAX_EMERGENCY_CONTACTS = 5;

function canUseLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch (err) {
    return false;
  }
}

function normalizeDisplayText(value, maxLen = 80) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeIdentifier(value, maxLen = 40) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, maxLen);
}

function safeMapCoordinate(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return fallback;
  }

  return Number(numeric.toFixed(6));
}

function parseStoredArray(key) {
  if (!canUseLocalStorage()) return [];

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`Failed to parse storage key ${key}:`, err);
    return [];
  }
}

function persistStoredArray(key, value) {
  if (!canUseLocalStorage()) return;

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to persist storage key ${key}:`, err);
  }
}

function sanitizeFavoriteEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const lat = Number(entry.lat);
  const lng = Number(entry.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const name = normalizeDisplayText(entry.name, 80) || 'Saved location';
  const ts = Number(entry.timestamp);

  return {
    lat,
    lng,
    name,
    timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now()
  };
}

function sanitizeEmergencyContactEntry(entry, fallbackId) {
  if (!entry || typeof entry !== 'object') return null;

  const name = normalizeDisplayText(entry.name, 40);
  const phone = sanitizePhoneNumber(entry.phone);
  const id = sanitizeIdentifier(entry.id, 40) || fallbackId;

  if (!name || !isValidPhoneNumber(phone)) return null;

  return {
    id,
    name,
    phone
  };
}

function loadFavoriteLocations() {
  const parsed = parseStoredArray(FAVORITES_STORAGE_KEY);
  const sanitized = [];

  parsed.forEach((entry) => {
    const normalized = sanitizeFavoriteEntry(entry);
    if (!normalized) return;
    sanitized.push(normalized);
  });

  return sanitized.slice(0, MAX_FAVORITES);
}

function loadEmergencyContacts() {
  const parsed = parseStoredArray(CONTACTS_STORAGE_KEY);
  const sanitized = [];
  const seen = new Set();

  parsed.forEach((entry, index) => {
    const normalized = sanitizeEmergencyContactEntry(entry, `contact_${index + 1}`);
    if (!normalized) return;

    const dedupeKey = normalized.phone;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    sanitized.push(normalized);
  });

  return sanitized.slice(0, MAX_EMERGENCY_CONTACTS);
}

let favoriteLocations = loadFavoriteLocations();
let emergencyContacts = loadEmergencyContacts();

let activeRoute = null;
let routeDestination = null;
let routeStepIndex = 0;
let navigationWatchId = null;
let mobilityRefreshTimerId = null;
let lastMobilityRefreshAt = 0;
let lastMobilitySuggestionAt = 0;
let lastMobilitySuggestedRouteId = '';

const MOBILITY_REFRESH_INTERVAL_MS = 9000;
const MOBILITY_NOTIFICATION_COOLDOWN_MS = 22000;
const MOBILITY_SWITCH_MIN_GAIN_SECONDS = 75;

let speechRecognition = null;
let isVoiceListening = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizePhoneNumber(phone) {
  const raw = String(phone || '').trim();
  const compact = raw.replace(/[^\d+]/g, '');
  const normalizedDigits = compact.replace(/\+/g, '');
  const hasLeadingPlus = compact.startsWith('+');

  return `${hasLeadingPlus ? '+' : ''}${normalizedDigits}`;
}

function isValidPhoneNumber(phone) {
  return /^\+?\d{6,20}$/.test(String(phone || ''));
}

function formatIncidentSourceLabel(source) {
  const key = String(source || 'unavailable');
  const labels = {
    'india-police-data': 'India Police public crime feed',
    'india-police-karnataka': 'Karnataka Police crime feed',
    'osm-civic-risk-proxy': 'OpenStreetMap civic risk proxy',
    'model-derived-risk-proxy': 'Model-derived civic proxy',
    'yolov8-sim-coco': 'YOLOv8 simulated CV feed',
    'safezone-product-risk-v1': 'Product-grade backend risk engine',
    'crime-feed-error': 'Crime feed temporary error',
    'public-crime-feed-unavailable': 'Regional crime feed unavailable',
    'osm-road-signals': 'OpenStreetMap road hazard feed',
    'accident-feed-error': 'Road hazard feed temporary error',
    'unavailable': 'Unavailable'
  };

  if (labels[key]) return labels[key];
  return key.replace(/-/g, ' ');
}

const GOOGLE_FALLBACK_NOTICE_WINDOW_MS = 15000;
let lastGoogleFallbackNoticeAt = 0;
let lastGoogleFallbackNoticeKey = '';

function isGoogleApiError(error) {
  return Boolean(error && typeof error.code === 'string' && error.code.indexOf('GOOGLE_') === 0);
}

function getGoogleFallbackMessage(error) {
  const code = String((error && error.code) || '');

  if (code === 'GOOGLE_UNAUTHORIZED') return 'Google API key was rejected (401 unauthorized).';
  if (code === 'GOOGLE_FORBIDDEN') return 'Google API request was denied (403 forbidden). Check key restrictions and enabled APIs.';
  if (code === 'GOOGLE_RATE_LIMITED') return 'Google API quota or rate limit was reached.';
  if (code === 'GOOGLE_TIMEOUT') return 'Google API request timed out.';
  if (code === 'GOOGLE_NETWORK') return 'Google API request failed due to network connectivity.';
  if (code === 'GOOGLE_INVALID_REQUEST') return 'Google API rejected the request parameters.';
  if (code === 'GOOGLE_SERVICE_UNAVAILABLE') return 'Google API service is temporarily unavailable.';

  return 'Google API request failed.';
}

function notifyGoogleFallback(error, fallbackProvider = 'fallback provider') {
  if (!isGoogleApiError(error)) return;

  const context = String((error && error.context) || 'request');
  const key = `${error.code}:${context}:${fallbackProvider}`;
  const now = Date.now();

  if (key === lastGoogleFallbackNoticeKey && now - lastGoogleFallbackNoticeAt < GOOGLE_FALLBACK_NOTICE_WINDOW_MS) {
    return;
  }

  lastGoogleFallbackNoticeKey = key;
  lastGoogleFallbackNoticeAt = now;

  const reason = getGoogleFallbackMessage(error);
  showNotification(`⚠️ ${reason} Using ${fallbackProvider}.`, 'warning', 5200);
}

if (typeof window !== 'undefined') {
  window.SafeZoneNotifyGoogleFallback = notifyGoogleFallback;
}

// ── Initialize Map ────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: false,
    attributionControl: false
  });

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('© OpenStreetMap contributors | SafeZone')
    .addTo(map);

  emergencyLayerGroup = L.layerGroup().addTo(map);
  cameraLayerGroup = L.layerGroup().addTo(map);
  propertiesLayerGroup = L.layerGroup().addTo(map);
  riskLayerGroup = L.layerGroup().addTo(map);

  initHeatmap();

  map.on('click', onMapClick);

  const slider = document.getElementById('timeSlider');
  slider.value = currentHour;
  slider.setAttribute('aria-label', 'Time of day slider');
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', '23');
  slider.setAttribute('aria-valuenow', currentHour);
  updateTimeDisplay();

  const hideLoading = () => {
    setTimeout(() => {
      document.getElementById('loadingOverlay').classList.add('hidden');
    }, 500);
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        map.setView([userLat, userLng], MAP_ZOOM);
        loadAreaData(userLat, userLng);
        hideLoading();
      },
      (error) => {
        console.warn('Geolocation failed or denied. Falling back to default.', error);
        loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);
        hideLoading();
      },
      { timeout: 10000, maximumAge: 0 }
    );
  } else {
    loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);
    hideLoading();
  }
}

// ── Load Area Data from APIs (Progressive) ───────────────────
async function loadAreaData(lat, lng) {
  if (isFetching) return;
  isFetching = true;
  hasApiErrors = false;

  showStatus('Scanning area...');
  currentMapCenter = [lat, lng];

  // Use defaults so partial results can render immediately
  let services = { police: [], hospital: [], fire: [] };
  let cameras = [];
  let properties = [];
  let areaInfo = { name: 'Loading...', fullAddress: '', area: '', type: 'unknown', category: 'unknown', countryCode: 'IN' };
  let riskData = null;
  let sidebarRendered = false;

  function tryRenderSidebar() {
    lastFetchedServices = services;
    lastFetchedCameras = cameras;
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;
    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    updateHeatmap();
    sidebarRendered = true;
  }

  // Fire all API calls concurrently, handle each as it arrives
  const servicesP = fetchNearbyAmenities(lat, lng, 3000).then(r => { services = r; updateEmergencyMarkers(services); }).catch(e => { console.warn('Amenities:', e); hasApiErrors = true; });
  const camerasP = fetchNearbyCameras(lat, lng, 2000).then(r => { cameras = Array.isArray(r) ? r : (r.cameras || []); updateCameraMarkers(cameras); }).catch(e => { console.warn('Cameras:', e); hasApiErrors = true; });
  const propsP = fetchNearbyProperties(lat, lng, 2000).then(r => { properties = r; updatePropertyMarkers(properties); }).catch(e => { console.warn('Properties:', e); });
  const geoP = reverseGeocode(lat, lng).then(r => { areaInfo = r; }).catch(e => { console.warn('Geocode:', e); hasApiErrors = true; });
  const riskP = fetchPublicSafetyRisk(lat, lng).then(r => { riskData = r; if (r && r.criticalError) hasApiErrors = true; updateRiskMarkers(riskData); }).catch(e => { console.warn('Risk:', e); hasApiErrors = true; });
  const backendAssessmentP = Promise.allSettled([servicesP, camerasP, geoP, riskP])
    .then(() => enrichRiskDataWithBackendAssessment(lat, lng, currentHour, services, cameras, areaInfo, riskData))
    .then((enriched) => {
      if (!enriched || typeof enriched !== 'object') return;
      riskData = enriched;
      updateRiskMarkers(riskData);
    })
    .catch((err) => {
      console.warn('Backend assessment:', err);
    });

  // Hard deadline: after 5 seconds, render whatever we have
  const deadline = new Promise(resolve => setTimeout(resolve, 5000));

  // Wait for EITHER all APIs to finish OR the deadline
  await Promise.race([
    Promise.allSettled([servicesP, camerasP, propsP, geoP, riskP]),
    deadline
  ]);

  // Render the sidebar with whatever data we have so far
  tryRenderSidebar();
  updateHeatmap();
  showStatus('');

  if (hasApiErrors) {
    showNotification('⚠️ Some feeds are unavailable. Showing best available estimates.', 'warning', 5000);
  }

  // Let remaining calls finish in background and update silently
  Promise.allSettled([servicesP, camerasP, propsP, geoP, riskP]).then(() => {
    lastFetchedServices = services;
    lastFetchedCameras = cameras;
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;
    updateHeatmap();
  });

  Promise.allSettled([backendAssessmentP]).then(() => {
    lastRiskData = riskData;
    updateRiskMarkers(riskData);
    updateHeatmap();
  });

  isFetching = false;
}

function showStatus(text) {
  let el = document.getElementById('statusIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'statusIndicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;top:75px;left:50%;transform:translateX(-50%);z-index:1002;background:rgba(99,102,241,0.9);backdrop-filter:blur(20px);color:white;padding:8px 20px;border-radius:30px;font-size:13px;font-weight:600;font-family:Inter,sans-serif;display:none;transition:all 0.3s ease;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
    document.body.appendChild(el);
  }

  if (text) {
    el.textContent = text;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ── Notification System ───────────────────────────────────────
function showNotification(message, type = 'info', duration = 3000) {
  const container = document.getElementById('notificationContainer') || createNotificationContainer();

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.setAttribute('role', 'alert');
  notification.setAttribute('aria-live', 'assertive');
  notification.textContent = message;

  container.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notificationContainer';
  container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;max-width:400px;';
  document.body.appendChild(container);
  return container;
}

// ── Heatmap Layer ─────────────────────────────────────────────
function initHeatmap() {
  const data = getHeatmapData(currentHour, currentMapCenter);
  heatLayer = L.heatLayer(data, {
    radius: 35,
    blur: 25,
    maxZoom: 17,
    max: 1.0,
    gradient: {
      0.0: '#22c55e33',
      0.2: '#22c55e',
      0.4: '#eab308',
      0.6: '#f97316',
      0.8: '#ef4444',
      1.0: '#dc2626'
    }
  }).addTo(map);
}

function updateHeatmap() {
  if (heatLayer) map.removeLayer(heatLayer);
  const data = getHeatmapData(currentHour, currentMapCenter);
  heatLayer = L.heatLayer(data, {
    radius: 35,
    blur: 25,
    maxZoom: 17,
    max: 1.0,
    gradient: {
      0.0: '#22c55e33',
      0.2: '#22c55e',
      0.4: '#eab308',
      0.6: '#f97316',
      0.8: '#ef4444',
      1.0: '#dc2626'
    }
  });

  if (layerState.heatmap) heatLayer.addTo(map);
}

// ── Emergency Service Markers ─────────────────────────────────
function updateEmergencyMarkers(services) {
  emergencyLayerGroup.clearLayers();

  const allServices = [
    ...services.police,
    ...services.hospital,
    ...services.fire
  ];

  allServices.forEach(service => {
    const iconClass = service.type === 'police' ? 'marker-police' :
      service.type === 'hospital' ? 'marker-hospital' : 'marker-fire';
    const emoji = service.type === 'police' ? '🚔' :
      service.type === 'hospital' ? '🏥' : '🚒';

    const icon = L.divIcon({
      html: `<div class="custom-marker ${iconClass}">${emoji}</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([service.lat, service.lng], { icon })
      .bindPopup(createServicePopup(service));

    emergencyLayerGroup.addLayer(marker);
  });

  if (!layerState.emergency) map.removeLayer(emergencyLayerGroup);
}

function createServicePopup(service) {
  const typeLabel = service.type.charAt(0).toUpperCase() + service.type.slice(1);
  const sourceTag = service.source === 'openstreetmap'
    ? '<div style="font-size:10px;color:#64748b;margin-top:6px;">📡 Verified via OpenStreetMap</div>'
    : service.source === 'google-places'
      ? '<div style="font-size:10px;color:#0ea5e9;margin-top:6px;">🗺 Verified via Google Places</div>'
      : '<div style="font-size:10px;color:#eab308;margin-top:6px;">⚠ Estimated location</div>';

  return `
    <div>
      <div class="popup-title">${escapeHtml(service.name)}</div>
      <span class="popup-type ${service.type}">${typeLabel}</span>
      ${service.address ? `<div class="popup-row"><span class="label">📍 Addr</span> ${escapeHtml(service.address)}</div>` : ''}
      <div class="popup-row"><span class="label">📞 Phone</span> <strong>${escapeHtml(service.phone)}</strong></div>
      <div class="popup-row"><span class="label">📏 Dist</span> ${formatDistance(service.distance)}</div>
      ${sourceTag}
    </div>
  `;
}

// ── Camera Markers ────────────────────────────────────────────
function updateCameraMarkers(cameras) {
  cameraLayerGroup.clearLayers();

  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);

  cameraArray.forEach(cam => {
    const icon = L.divIcon({
      html: `<div class="custom-marker marker-camera" style="opacity: ${cam.status === 'active' ? '1' : '0.5'}" role="img" aria-label="CCTV Camera">📹</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([cam.lat, cam.lng], { icon })
      .bindPopup(createCameraPopup(cam));

    const circle = L.circle([cam.lat, cam.lng], {
      radius: cam.coverage,
      color: cam.status === 'active' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)',
      fillColor: cam.status === 'active' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
      fillOpacity: 1,
      weight: 1
    });

    cameraLayerGroup.addLayer(marker);
    cameraLayerGroup.addLayer(circle);
  });

  if (!layerState.cameras) map.removeLayer(cameraLayerGroup);
}

function createCameraPopup(cam) {
  const statusColor = cam.status === 'active' ? '#22c55e' : '#eab308';
  const sourceTag = cam.source === 'openstreetmap'
    ? '<div style="font-size:10px;color:#64748b;margin-top:4px;">📡 Verified via OpenStreetMap</div>'
    : cam.source === 'google-places'
      ? '<div style="font-size:10px;color:#0ea5e9;margin-top:4px;">🗺 Google Places nearby result</div>'
      : '<div style="font-size:10px;color:#eab308;margin-top:4px;">⚠ Estimated</div>';

  return `
    <div>
      <div class="popup-title">${escapeHtml(cam.name)}</div>
      <span class="popup-type camera">${escapeHtml(cam.status.toUpperCase())}</span>
      <div class="popup-row"><span class="label">📐 Range</span> ${cam.coverage}m radius</div>
      <div class="popup-row"><span class="label">🎥 Quality</span> ${escapeHtml(cam.resolution)}</div>
      <div class="popup-row"><span class="label">⚡ Status</span> <span style="color: ${statusColor}">${cam.status === 'active' ? '● Online' : '● Maintenance'}</span></div>
      ${sourceTag}
    </div>
  `;
}

// ── Property Markers ──────────────────────────────────────────
function updatePropertyMarkers(properties) {
  propertiesLayerGroup.clearLayers();

  properties.forEach(prop => {
    const icon = L.divIcon({
      html: '<div class="custom-marker marker-property" role="img" aria-label="Property">🏠</div>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([prop.lat, prop.lng], { icon })
      .bindPopup(createPropertyPopup(prop));

    marker.on('click', () => {
      onMapClick({ latlng: { lat: prop.lat, lng: prop.lng } });
    });

    propertiesLayerGroup.addLayer(marker);
  });

  if (!layerState.properties) map.removeLayer(propertiesLayerGroup);
}

function createPropertyPopup(prop) {
  return `
    <div style="min-width: 200px;">
      <img src="${escapeHtml(prop.image)}" alt="Property" style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px 8px 0 0; margin: -14px -14px 10px -14px; width: calc(100% + 28px); max-width: none;">
      <div class="popup-title">${escapeHtml(prop.title)}</div>
      <span class="popup-type ${prop.type === 'For Sale' ? 'police' : 'hospital'}">${escapeHtml(prop.type)}</span>
      <div style="font-size: 16px; font-weight: bold; color: var(--accent-light); margin: 6px 0;">${escapeHtml(prop.price)}</div>
      <div class="popup-row">🛏️ ${prop.beds} Beds | 🛁 ${prop.baths} Baths</div>
      <div class="popup-row">📐 ${prop.sqft} sqft</div>
      <div style="font-size:10px;color:#64748b;margin-top:6px;">Broker API Data (Simulated)</div>
    </div>
  `;
}

// ── Risk Markers ──────────────────────────────────────────────
function updateRiskMarkers(riskData) {
  riskLayerGroup.clearLayers();
  if (!riskData || !Array.isArray(riskData.hotspots)) return;

  riskData.hotspots.slice(0, 50).forEach(point => {
    const color = point.type === 'theft' ? '#ef4444' :
      point.type === 'violent' ? '#f97316' :
        point.type === 'accident' ? '#f59e0b' : '#eab308';

    const marker = L.circleMarker([point.lat, point.lng], {
      radius: 6,
      color,
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.3
    }).bindPopup(`
      <div>
        <div class="popup-title">${escapeHtml(point.title || 'Risk signal')}</div>
        <div class="popup-row"><span class="label">⚠ Type</span> ${escapeHtml(point.type || 'incident')}</div>
        <div class="popup-row"><span class="label">📡 Source</span> ${escapeHtml(point.source || 'Public feed')}</div>
      </div>
    `);

    riskLayerGroup.addLayer(marker);
  });

  if (!layerState.risk) map.removeLayer(riskLayerGroup);
}

function withTimeoutFallback(promise, timeoutMs, fallbackValue, label = 'request') {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`${label} timed out after ${timeoutMs}ms`);
      resolve(typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function compactServicePayload(services, key, limit = 6) {
  const list = services && Array.isArray(services[key]) ? services[key] : [];
  return list.slice(0, limit).map((item, index) => ({
    id: item && item.id ? String(item.id) : `${key}_${index + 1}`,
    distance: Math.max(0, Number(item && item.distance || 0)),
    status: item && item.status ? String(item.status) : undefined
  }));
}

function buildBackendSafetyPayload(lat, lng, hour, services, cameras, areaInfo, riskData) {
  const normalizedHour = Number.isFinite(Number(hour)) ? Number(hour) : new Date().getHours();
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras && Array.isArray(cameras.cameras) ? cameras.cameras : []);

  return {
    lat,
    lng,
    hour: normalizedHour,
    areaInfo: {
      name: String(areaInfo && areaInfo.name || 'Selected location'),
      type: String(areaInfo && areaInfo.type || 'unknown'),
      category: String(areaInfo && areaInfo.category || 'unknown')
    },
    services: {
      police: compactServicePayload(services, 'police', 8),
      hospital: compactServicePayload(services, 'hospital', 8),
      fire: compactServicePayload(services, 'fire', 6)
    },
    cameras: cameraArray.slice(0, 20).map((camera, index) => ({
      id: camera && camera.id ? String(camera.id) : `camera_${index + 1}`,
      status: String(camera && camera.status || 'unknown'),
      coverage: Math.max(0, Number(camera && camera.coverage || 0)),
      distance: Math.max(0, Number(camera && camera.distance || 0))
    })),
    publicRisk: {
      theftCount: Math.max(0, Number(riskData && riskData.theftCount || 0)),
      violentCount: Math.max(0, Number(riskData && riskData.violentCount || 0)),
      accidentHotspots: Math.max(0, Number(riskData && riskData.accidentHotspots || 0)),
      conflictPoints: Math.max(0, Number(riskData && riskData.conflictPoints || 0)),
      reliabilityScore: Number(riskData && riskData.reliabilityScore || 0),
      confidence: String(riskData && riskData.confidence || 'low')
    }
  };
}

async function enrichRiskDataWithBackendAssessment(lat, lng, hour, services, cameras, areaInfo, riskData) {
  if (typeof fetchBackendSafetyAssessment !== 'function' || typeof mergeRiskDataWithBackendAssessment !== 'function') {
    return riskData;
  }

  const payload = buildBackendSafetyPayload(lat, lng, hour, services, cameras, areaInfo, riskData);
  const backendAssessment = await withTimeoutFallback(
    fetchBackendSafetyAssessment(payload),
    5400,
    null,
    'Backend product-grade scoring'
  );

  if (!backendAssessment) {
    return riskData;
  }

  return mergeRiskDataWithBackendAssessment(riskData, backendAssessment);
}

// ── Map Click Handler ─────────────────────────────────────────
async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  const requestId = ++activeScanRequestId;

  if (selectedMarker) map.removeLayer(selectedMarker);

  const icon = L.divIcon({
    html: '<div class="custom-marker marker-selected" role="img" aria-label="Selected location"></div>',
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  selectedMarker = L.marker([lat, lng], { icon }).addTo(map);

  openSidebar();
  showSidebarLoading();

  let services = { police: [], hospital: [], fire: [] };
  let cameras = [];
  let properties = [];
  let areaInfo = {
    name: 'Selected location',
    fullAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    area: '',
    type: 'unknown',
    category: 'unknown',
    countryCode: currentCountryCode || 'IN'
  };
  let riskData = {
    theftCount: 0,
    violentCount: 0,
    totalCrime: 0,
    accidentHotspots: 0,
    conflictPoints: 0,
    penalty: 0,
    factors: ['Public risk feeds unavailable, using base model only'],
    confidence: 'low',
    month: 'latest',
    hotspots: [],
    sources: {
      crime: 'unavailable',
      accidents: 'unavailable'
    },
    partialError: true,
    criticalError: true,
    error: 'API_FAILED'
  };
  let scanHadErrors = false;

  try {
    const servicesP = withTimeoutFallback(
      fetchNearbyAmenities(lat, lng, 3000),
      SCAN_CALL_TIMEOUT_MS,
      () => ({ police: [], hospital: [], fire: [], error: 'API_TIMEOUT' }),
      'Amenities fetch'
    ).then((result) => {
      services = result || services;
      if (services && services.error) scanHadErrors = true;
      if (requestId !== activeScanRequestId) return;
      updateEmergencyMarkers(services);
    }).catch((err) => {
      console.warn('Amenities fetch failed during scan:', err);
      scanHadErrors = true;
    });

    const camerasP = withTimeoutFallback(
      fetchNearbyCameras(lat, lng, 2000),
      SCAN_CALL_TIMEOUT_MS,
      () => ({ cameras: [], error: 'API_TIMEOUT' }),
      'Camera fetch'
    ).then((result) => {
      const cameraArray = Array.isArray(result) ? result : (result && Array.isArray(result.cameras) ? result.cameras : []);
      cameras = cameraArray;
      if (result && result.error) scanHadErrors = true;
      if (requestId !== activeScanRequestId) return;
      updateCameraMarkers(cameras);
    }).catch((err) => {
      console.warn('Camera fetch failed during scan:', err);
      scanHadErrors = true;
    });

    const propertiesP = withTimeoutFallback(
      fetchNearbyProperties(lat, lng, 2000),
      SCAN_CALL_TIMEOUT_MS,
      () => [],
      'Property fetch'
    ).then((result) => {
      properties = Array.isArray(result) ? result : [];
      if (requestId !== activeScanRequestId) return;
      updatePropertyMarkers(properties);
    }).catch((err) => {
      console.warn('Property fetch failed during scan:', err);
      scanHadErrors = true;
    });

    const geocodeP = withTimeoutFallback(
      reverseGeocode(lat, lng),
      SCAN_CALL_TIMEOUT_MS,
      () => areaInfo,
      'Reverse geocode'
    ).then((result) => {
      if (result && typeof result === 'object') {
        areaInfo = {
          ...areaInfo,
          ...result
        };
      }
      if (result && result.error) scanHadErrors = true;
    }).catch((err) => {
      console.warn('Reverse geocode failed during scan:', err);
      scanHadErrors = true;
    });

    const riskP = withTimeoutFallback(
      fetchPublicSafetyRisk(lat, lng),
      SCAN_CALL_TIMEOUT_MS,
      () => ({
        theftCount: 0,
        violentCount: 0,
        totalCrime: 0,
        accidentHotspots: 0,
        conflictPoints: 0,
        penalty: 0,
        factors: ['Public risk feeds timed out, using base model only'],
        confidence: 'low',
        month: 'latest',
        hotspots: [],
        sources: {
          crime: 'unavailable',
          accidents: 'unavailable'
        },
        partialError: true,
        criticalError: true,
        error: 'API_TIMEOUT'
      }),
      'Public safety risk fetch'
    ).then((result) => {
      if (result && typeof result === 'object') {
        riskData = result;
      }
      if (riskData && (riskData.error || riskData.partialError || riskData.criticalError)) {
        scanHadErrors = true;
      }
      if (requestId !== activeScanRequestId) return;
      updateRiskMarkers(riskData);
    }).catch((err) => {
      console.warn('Public safety risk fetch failed during scan:', err);
      scanHadErrors = true;
    });

    const backendAssessmentP = Promise.allSettled([servicesP, camerasP, geocodeP, riskP])
      .then(() => enrichRiskDataWithBackendAssessment(lat, lng, currentHour, services, cameras, areaInfo, riskData))
      .then((enriched) => {
        if (!enriched || typeof enriched !== 'object') return;
        riskData = enriched;
        if (requestId !== activeScanRequestId) return;
        updateRiskMarkers(riskData);
      })
      .catch((err) => {
        console.warn('Backend assessment failed during scan:', err);
      });

    const allFetches = [servicesP, camerasP, propertiesP, geocodeP, riskP];
    const completedBeforeDeadline = await Promise.race([
      Promise.allSettled(allFetches).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), SCAN_SOFT_DEADLINE_MS))
    ]);

    if (!completedBeforeDeadline) {
      scanHadErrors = true;
    }

    if (requestId !== activeScanRequestId) return;

    hasApiErrors = scanHadErrors;
    lastFetchedServices = services;
    lastFetchedCameras = cameras;
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;

    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    refreshSelectedSidebar();

    if (scanHadErrors) {
      showNotification('⚠️ Some feeds are slow or unavailable. Showing best available estimates.', 'warning', 5000);
    }

    Promise.allSettled([...allFetches, backendAssessmentP]).then(() => {
      if (requestId !== activeScanRequestId) return;

      hasApiErrors = scanHadErrors;
      lastFetchedServices = services;
      lastFetchedCameras = cameras;
      lastFetchedProperties = properties;
      lastAreaInfo = areaInfo;
      lastRiskData = riskData;
      updateEmergencyMarkers(services);
      updateCameraMarkers(cameras);
      updatePropertyMarkers(properties);
      updateRiskMarkers(riskData);
      refreshSelectedSidebar();
    });
  } catch (err) {
    if (requestId !== activeScanRequestId) return;
    console.error('Error fetching location data:', err);
    hasApiErrors = true;

    lastFetchedServices = services;
    lastFetchedCameras = cameras;
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;

    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    refreshSelectedSidebar();

    showNotification('⚠️ Scan timed out. Showing limited data for this area.', 'warning', 5000);
  }
}

function refreshSelectedSidebar() {
  if (!selectedMarker || !lastFetchedServices || !lastAreaInfo) return;

  const pos = selectedMarker.getLatLng();
  const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo, lastRiskData, { lat: pos.lat, lng: pos.lng });
  const level = getSafetyLevel(scoreData.score);
  const riskOutput = generateRiskFactors(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo, lastRiskData);

  updateSidebar(
    scoreData.score,
    level,
    lastAreaInfo,
    lastFetchedServices,
    lastFetchedCameras,
    riskOutput.risks,
    riskOutput.features,
    pos.lat,
    pos.lng,
    scoreData.factors,
    lastRiskData
  );
}

function showSidebarLoading() {
  document.getElementById('sidebarContent').innerHTML = `
    <div style="text-align:center; padding: 60px 20px;">
      <div class="loading-spinner" style="margin: 0 auto 16px;"></div>
      <p style="color: var(--text-muted); font-size: 14px;">Scanning area...</p>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">Fetching services, incidents, and local context</p>
    </div>
  `;
}

function normalizeHourValue(hour) {
  const numericHour = Number(hour);
  if (!Number.isFinite(numericHour)) return new Date().getHours();
  return ((Math.round(numericHour) % 24) + 24) % 24;
}

function getConfidenceTone(confidenceValue) {
  const normalized = String(confidenceValue || 'low').trim().toLowerCase();
  if (normalized === 'high') {
    return {
      label: 'High confidence',
      className: 'high'
    };
  }

  if (normalized === 'medium') {
    return {
      label: 'Medium confidence',
      className: 'medium'
    };
  }

  return {
    label: 'Low confidence',
    className: 'low'
  };
}

function buildSafetyOutlookSummary(hour, services, cameras, areaInfo, riskData) {
  const normalizedHour = normalizeHourValue(hour);
  const projectionRiskData = riskData && typeof riskData === 'object' && riskData.productAssessment
    ? { ...riskData, productAssessment: null }
    : riskData;

  const nowProjection = calculateSafetyScore(normalizedHour, services, cameras, areaInfo, projectionRiskData);
  const baseScore = Number.isFinite(Number(nowProjection && nowProjection.score))
    ? Number(nowProjection.score)
    : 50;

  const windows = [
    { offset: 0, label: 'Now' },
    { offset: 1, label: '+1 hour' },
    { offset: 3, label: '+3 hours' }
  ];

  return windows.map((windowItem) => {
    const projectedHour = (normalizedHour + windowItem.offset) % 24;
    const scoreData = calculateSafetyScore(projectedHour, services, cameras, areaInfo, projectionRiskData);
    const projectedScore = Number.isFinite(Number(scoreData && scoreData.score))
      ? Math.round(Number(scoreData.score))
      : Math.round(baseScore);

    const delta = projectedScore - Math.round(baseScore);
    const deltaLabel = delta === 0
      ? 'Stable trend'
      : `${delta > 0 ? '+' : ''}${delta} vs now`;

    return {
      label: `${windowItem.label} (${formatTime(projectedHour)})`,
      score: projectedScore,
      deltaLabel,
      stateClass: delta >= 4 ? 'safer' : delta <= -4 ? 'riskier' : 'steady'
    };
  });
}

function buildEmergencyReadinessSummary(services, activeCameraCount) {
  const nearestPolice = Array.isArray(services && services.police) && services.police.length > 0
    ? services.police[0]
    : null;
  const nearestHospital = Array.isArray(services && services.hospital) && services.hospital.length > 0
    ? services.hospital[0]
    : null;
  const nearestFire = Array.isArray(services && services.fire) && services.fire.length > 0
    ? services.fire[0]
    : null;

  let score = 100;

  const policeDistance = Number(nearestPolice && nearestPolice.distance);
  if (!nearestPolice) score -= 34;
  else if (Number.isFinite(policeDistance) && policeDistance > 2500) score -= 22;
  else if (Number.isFinite(policeDistance) && policeDistance > 1500) score -= 12;
  else if (Number.isFinite(policeDistance) && policeDistance > 900) score -= 6;

  const hospitalDistance = Number(nearestHospital && nearestHospital.distance);
  if (!nearestHospital) score -= 30;
  else if (Number.isFinite(hospitalDistance) && hospitalDistance > 2500) score -= 20;
  else if (Number.isFinite(hospitalDistance) && hospitalDistance > 1500) score -= 10;
  else if (Number.isFinite(hospitalDistance) && hospitalDistance > 900) score -= 4;

  const fireDistance = Number(nearestFire && nearestFire.distance);
  if (!nearestFire) score -= 18;
  else if (Number.isFinite(fireDistance) && fireDistance > 2800) score -= 12;
  else if (Number.isFinite(fireDistance) && fireDistance > 1800) score -= 7;
  else if (Number.isFinite(fireDistance) && fireDistance > 1000) score -= 3;

  if (activeCameraCount === 0) score -= 14;
  else if (activeCameraCount < 2) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (score >= 75) {
    return {
      score,
      label: 'Ready for travel',
      className: 'ready',
      summary: 'Emergency coverage and visibility are strong for this location.'
    };
  }

  if (score >= 50) {
    return {
      score,
      label: 'Watchful travel',
      className: 'watchful',
      summary: 'Travel is possible, but keep emergency actions and route choices active.'
    };
  }

  return {
    score,
    label: 'Limited readiness',
    className: 'limited',
    summary: 'Emergency response may be delayed. Use extra caution and share your route.'
  };
}

function buildSafetyChecklist(hour, nearestPolice, nearestHospital, activeCameraCount) {
  const checklist = [];
  const normalizedHour = normalizeHourValue(hour);

  if (normalizedHour >= 21 || normalizedHour <= 5) {
    checklist.push('Prefer well-lit main roads during late-hour travel.');
  }

  if (!nearestPolice || Number(nearestPolice.distance) > 2000) {
    checklist.push('Share live location with a trusted contact before departure.');
  }

  if (!nearestHospital || Number(nearestHospital.distance) > 2500) {
    checklist.push('Keep emergency transport options ready for medical support.');
  }

  if (activeCameraCount < 2) {
    checklist.push('Stay near populated routes with visible surveillance coverage.');
  }

  checklist.push('Keep your phone charged and emergency numbers one tap away.');
  return checklist.slice(0, 3);
}

// ── Sidebar ───────────────────────────────────────────────────
function updateSidebar(score, level, areaInfo, services, cameras, risks, features, lat, lng, factors, riskData) {
  const scoreColor = level.class === 'very-safe' ? '#22c55e' :
    level.class === 'moderate' ? '#eab308' :
      level.class === 'caution' ? '#f97316' : '#ef4444';

  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
  const activeCams = cameraArray.filter(c => c.status === 'active');
  const safeAreaName = escapeJsString(areaInfo.name || 'Selected location');
  const crimeSourceLabel = riskData ? formatIncidentSourceLabel(riskData.sources && riskData.sources.crime) : 'Unavailable';
  const accidentSourceLabel = riskData ? formatIncidentSourceLabel(riskData.sources && riskData.sources.accidents) : 'Unavailable';
  const riskReliability = riskData && Number.isFinite(Number(riskData.reliabilityScore))
    ? Math.round(Number(riskData.reliabilityScore))
    : null;
  const crimeQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.crime))
    ? Math.round(Number(riskData.dataQuality.crime))
    : null;
  const accidentQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.accidents))
    ? Math.round(Number(riskData.dataQuality.accidents))
    : null;
  const cvQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.cv))
    ? Math.round(Number(riskData.dataQuality.cv))
    : null;
  const cvSourceLabel = riskData && riskData.sources
    ? formatIncidentSourceLabel(riskData.sources.cv)
    : 'Unavailable';
  const cvRiskScore = riskData && riskData.cvSignals && Number.isFinite(Number(riskData.cvSignals.score))
    ? Math.round(Number(riskData.cvSignals.score))
    : null;
  const cvRiskLevel = riskData && riskData.cvSignals
    ? String(riskData.cvSignals.level || 'low')
    : 'low';
  const productScore = riskData && riskData.productAssessment && Number.isFinite(Number(riskData.productAssessment.score))
    ? Math.round(Number(riskData.productAssessment.score))
    : null;
  const productModel = riskData && riskData.productAssessment
    ? String(riskData.productAssessment.model || 'safezone-product-risk-v1')
    : '';
  const deploymentGrade = riskData && riskData.productAssessment && riskData.productAssessment.deploymentReadiness
    ? String(riskData.productAssessment.deploymentReadiness.grade || '')
    : '';
  const usesProxyRisk = Boolean(riskData && riskData.sources && (
    String(riskData.sources.crime || '').includes('proxy') ||
    String(riskData.sources.accidents || '').includes('proxy')
  ));
  const safeLat = safeMapCoordinate(lat, -90, 90);
  const safeLng = safeMapCoordinate(lng, -180, 180);
  const normalizedHour = normalizeHourValue(currentHour);
  const confidenceTone = getConfidenceTone(riskData && riskData.confidence);
  const safetyOutlook = buildSafetyOutlookSummary(normalizedHour, services, cameraArray, areaInfo, riskData);
  const nearestPolice = Array.isArray(services.police) && services.police.length > 0 ? services.police[0] : null;
  const nearestHospital = Array.isArray(services.hospital) && services.hospital.length > 0 ? services.hospital[0] : null;
  const nearestFire = Array.isArray(services.fire) && services.fire.length > 0 ? services.fire[0] : null;
  const readinessSummary = buildEmergencyReadinessSummary(services, activeCams.length);
  const readinessChecklist = buildSafetyChecklist(normalizedHour, nearestPolice, nearestHospital, activeCams.length);
  const snapshotReasons = [...(Array.isArray(risks) ? risks : []), ...(Array.isArray(factors) ? factors : [])]
    .map((item) => normalizeDisplayText(item, 120))
    .filter(Boolean)
    .slice(0, 3);
  const snapshotActionsRaw = Array.isArray(riskData && riskData.recommendations) && riskData.recommendations.length > 0
    ? riskData.recommendations
    : (Array.isArray(features) ? features : []);
  const snapshotActions = snapshotActionsRaw
    .map((item) => normalizeDisplayText(item, 110))
    .filter(Boolean)
    .slice(0, 2);
  const updatedAt = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  const emergencyDial = (() => {
    const normalizedUnified = sanitizePhoneNumber(nums.unified);
    if (isValidPhoneNumber(normalizedUnified)) return normalizedUnified;

    const normalizedPolice = sanitizePhoneNumber(nums.police);
    if (isValidPhoneNumber(normalizedPolice)) return normalizedPolice;

    return '';
  })();
  const nearestHospitalLat = nearestHospital
    ? safeMapCoordinate(nearestHospital.lat, -90, 90)
    : null;
  const nearestHospitalLng = nearestHospital
    ? safeMapCoordinate(nearestHospital.lng, -180, 180)
    : null;
  const nearestHospitalName = nearestHospital
    ? escapeJsString(nearestHospital.name || 'Nearest hospital')
    : '';

  if (snapshotReasons.length === 0) {
    snapshotReasons.push('No major risk signals detected for this location at this time.');
  }

  const isFavorite = favoriteLocations.some(fav =>
    Math.abs(fav.lat - safeLat) < 0.0001 && Math.abs(fav.lng - safeLng) < 0.0001
  );

  document.getElementById('sidebarContent').innerHTML = `
    ${hasApiErrors ? `
      <div class="data-disclaimer warning" role="alert">
        <span class="disclaimer-icon">⚠️</span>
        <div>
          <div class="disclaimer-title">Using Estimated Data</div>
          <div class="disclaimer-text">Some data sources are temporarily unavailable. Showing estimated information.</div>
        </div>
      </div>
    ` : ''}

    <div class="data-disclaimer info" role="status">
      <span class="disclaimer-icon">ℹ️</span>
      <div>
        <div class="disclaimer-title">How This Score Works</div>
        <div class="disclaimer-text">Based on emergency service proximity, surveillance coverage, time-of-day risk, and <strong>NCRB published crime rates</strong> (where available). This is an estimate — not an official safety rating. Always use your own judgment.</div>
      </div>
    </div>

    <div class="safety-score-card ${level.class}">
      <div class="score-circle" style="--score-pct: ${score}; --score-color: ${scoreColor}">
        <div>
          <div class="score-number" style="color: ${scoreColor}">${score}</div>
          <div class="score-label">/ 100</div>
        </div>
      </div>
      <div class="safety-label" style="color: ${scoreColor}">${level.icon} ${level.label}</div>
      <div class="zone-name">${escapeHtml(areaInfo.name)} • ${formatTime(normalizedHour)}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(areaInfo.area || '')}</div>

      <button class="favorite-btn ${isFavorite ? 'active' : ''}" onclick="toggleFavorite(${safeLat}, ${safeLng}, '${safeAreaName}')" aria-label="${isFavorite ? 'Remove' : 'Save'} location ${escapeHtml(areaInfo.name)}">
        ${isFavorite ? '⭐ Saved' : '☆ Save Location'}
      </button>
      <button class="route-now-btn" onclick="startDirectionsTo(${safeLat}, ${safeLng}, '${safeAreaName}')" aria-label="Get turn-by-turn directions to ${escapeHtml(areaInfo.name)}">
        🧭 Directions Here
      </button>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🧭</span> Safety Snapshot</div>
      <div class="snapshot-card ${level.class}">
        <div class="snapshot-header">
          <div>
            <div class="snapshot-title">${escapeHtml(level.label)} outlook</div>
            <div class="snapshot-meta">Updated ${escapeHtml(updatedAt)} • ${escapeHtml(areaInfo.name)}</div>
          </div>
          <div class="snapshot-confidence ${confidenceTone.className}">
            <strong>${escapeHtml(confidenceTone.label)}</strong>
            <span>${riskReliability !== null ? `${riskReliability}% reliability` : 'Model confidence signal'}</span>
          </div>
        </div>

        <div class="snapshot-outlook-grid">
          ${safetyOutlook.map((windowItem) => `
            <div class="snapshot-outlook-tile ${windowItem.stateClass}">
              <div class="outlook-window">${escapeHtml(windowItem.label)}</div>
              <div class="outlook-score">${windowItem.score}</div>
              <div class="outlook-meta">${escapeHtml(windowItem.deltaLabel)}</div>
            </div>
          `).join('')}
        </div>

        <div class="snapshot-list">
          ${snapshotReasons.map((reason) => `<div class="snapshot-list-item">${escapeHtml(reason)}</div>`).join('')}
        </div>

        ${snapshotActions.length > 0 ? `
          <div class="snapshot-chips">
            ${snapshotActions.map((action) => `<span class="snapshot-chip">${escapeHtml(action)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📊</span> Score Breakdown</div>
      <div class="score-factors">
        ${factors.map(f => `<div class="factor-item">${escapeHtml(f)}</div>`).join('')}
      </div>
    </div>

    ${riskData ? `
      <div class="section">
        <div class="section-title"><span class="icon">🚨</span> Public Incident Intelligence</div>
        <div class="camera-stats">
          <div class="cam-stat">
            <div class="cam-stat-value">${riskData.theftCount || 0}</div>
            <div class="cam-stat-label">Theft Signals</div>
          </div>
          <div class="cam-stat">
            <div class="cam-stat-value">${riskData.accidentHotspots || 0}</div>
            <div class="cam-stat-label">Accident Hotspots</div>
          </div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.5;">
          Confidence: ${escapeHtml(riskData.confidence || 'low')} • Crime source: ${escapeHtml(crimeSourceLabel)} • Accident source: ${escapeHtml(accidentSourceLabel)}
        </div>
        ${riskReliability !== null ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Estimated data reliability: ${riskReliability}%${crimeQuality !== null ? ` • Crime quality ${crimeQuality}%` : ''}${accidentQuality !== null ? ` • Accident quality ${accidentQuality}%` : ''}${cvQuality !== null ? ` • CV quality ${cvQuality}%` : ''}</div>` : ''}
        ${productScore !== null ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Product-grade score: ${productScore}/100 via ${escapeHtml(productModel)}${deploymentGrade ? ` • ${escapeHtml(deploymentGrade)}` : ''}</div>` : ''}
        ${cvRiskScore !== null ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Simulated scene risk: ${cvRiskScore}/100 (${escapeHtml(cvRiskLevel)}) • Source: ${escapeHtml(cvSourceLabel)}</div>` : ''}
        ${riskData && Array.isArray(riskData.recommendations) && riskData.recommendations.length > 0 ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">Recommendation: ${escapeHtml(riskData.recommendations[0])}</div>` : ''}
        ${usesProxyRisk ? '<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">Using civic proxy signals for areas without official open crime APIs.</div>' : ''}
      </div>
    ` : ''}

    ${(function() {
      if (typeof getNcrbCrimeRate !== 'function') return '';
      const ncrbResult = getNcrbCrimeRate(safeLat, safeLng);
      if (!ncrbResult) return '';
      const r = ncrbResult.rates;
      const riskColor = ncrbResult.riskIndex > 2.0 ? '#ef4444' :
        ncrbResult.riskIndex > 1.3 ? '#f97316' :
        ncrbResult.riskIndex > 0.9 ? '#eab308' : '#22c55e';
      return `
        <div class="section">
          <div class="section-title"><span class="icon">📊</span> NCRB Crime Statistics</div>
          <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.18); border-radius: 12px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div>
                <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${escapeHtml(ncrbResult.name)}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(ncrbResult.level)}-level data • ${ncrbResult.dataYear}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 18px; font-weight: 700; color: ${riskColor};">${ncrbResult.riskIndex}×</div>
                <div style="font-size: 10px; color: var(--text-muted);">vs national avg</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;">
              <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.15); border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${r.theft}</div>
                <div style="font-size: 9px; color: var(--text-muted);">Theft/lakh</div>
              </div>
              <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.15); border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${r.robbery}</div>
                <div style="font-size: 9px; color: var(--text-muted);">Robbery/lakh</div>
              </div>
              <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.15); border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${r.assault}</div>
                <div style="font-size: 9px; color: var(--text-muted);">Assault/lakh</div>
              </div>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); line-height: 1.4;">
              Total IPC rate: ${r.total}/lakh • National avg: ${ncrbResult.nationalAverage.total}/lakh<br>
              Source: ${escapeHtml(ncrbResult.attribution)}
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; font-style: italic;">
              ⚠ Rates reflect registered FIRs. Higher rates may indicate better reporting, not necessarily more danger.
            </div>
          </div>
        </div>
      `;
    })()}

    <div class="section">
      <div class="section-title"><span class="icon">🚑</span> Emergency Readiness</div>
      <div class="readiness-card ${readinessSummary.className}">
        <div class="readiness-header">
          <div>
            <div class="readiness-label">${escapeHtml(readinessSummary.label)}</div>
            <div class="readiness-description">${escapeHtml(readinessSummary.summary)}</div>
          </div>
          <div class="readiness-score">${readinessSummary.score}/100</div>
        </div>

        <div class="readiness-metrics">
          <div class="readiness-metric">
            <div class="metric-name">Police Reach</div>
            <div class="metric-value">${nearestPolice ? escapeHtml(formatDistance(Number(nearestPolice.distance || 0))) : 'Not found'}</div>
          </div>
          <div class="readiness-metric">
            <div class="metric-name">Hospital Reach</div>
            <div class="metric-value">${nearestHospital ? escapeHtml(formatDistance(Number(nearestHospital.distance || 0))) : 'Not found'}</div>
          </div>
          <div class="readiness-metric">
            <div class="metric-name">Fire Reach</div>
            <div class="metric-value">${nearestFire ? escapeHtml(formatDistance(Number(nearestFire.distance || 0))) : 'Not found'}</div>
          </div>
        </div>

        <div class="readiness-metrics single-line">
          <div class="readiness-metric">
            <div class="metric-name">Active Cameras</div>
            <div class="metric-value">${activeCams.length}</div>
          </div>
          <div class="readiness-metric">
            <div class="metric-name">Travel Time</div>
            <div class="metric-value">${formatTime(normalizedHour)}</div>
          </div>
          <div class="readiness-metric">
            <div class="metric-name">Emergency Number</div>
            <div class="metric-value">${escapeHtml(nums.unified || nums.police || 'Unavailable')}</div>
          </div>
        </div>

        <div class="readiness-actions">
          ${emergencyDial ? `<a class="readiness-btn emergency" href="tel:${escapeHtml(emergencyDial)}" aria-label="Call emergency number ${escapeHtml(nums.unified || nums.police || emergencyDial)}">Call Emergency</a>` : `<button class="readiness-btn emergency disabled" disabled aria-disabled="true">Call Emergency</button>`}
          <button class="readiness-btn secondary" onclick="openEmergencyContacts()" aria-label="Open emergency contacts">Alert Contacts</button>
          ${nearestHospital && nearestHospitalLat !== null && nearestHospitalLng !== null ? `<button class="readiness-btn neutral" onclick="startDirectionsTo(${nearestHospitalLat}, ${nearestHospitalLng}, '${nearestHospitalName}')" aria-label="Route to nearest hospital ${escapeHtml(nearestHospital.name || 'nearest hospital')}">Route to Hospital</button>` : ''}
        </div>

        <div class="readiness-checklist">
          ${readinessChecklist.map((item) => `<div class="checklist-item">- ${escapeHtml(item)}</div>`).join('')}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📍</span> Location</div>
      <div style="font-size: 12px; color: var(--text-secondary); padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-glass); line-height: 1.6;">
        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">${escapeHtml(areaInfo.name)}</div>
        <div>${escapeHtml(areaInfo.fullAddress || '')}</div>
        <div style="color: var(--text-muted); margin-top: 4px; font-size: 11px;">${safeLat.toFixed(5)}, ${safeLng.toFixed(5)}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📞</span> Emergency Numbers (${escapeHtml(nums.country || currentCountryCode)})</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚨</div>
          <div class="service-info">
            <div class="service-name" style="color: #ef4444;">${escapeHtml(nums.unified)}</div>
            <div class="service-meta">Unified Emergency</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚔</div>
          <div class="service-info">
            <div class="service-name" style="color: var(--accent-light);">${escapeHtml(nums.police)}</div>
            <div class="service-meta">Police</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚑</div>
          <div class="service-info">
            <div class="service-name" style="color: #22c55e;">${escapeHtml(nums.ambulance)}</div>
            <div class="service-meta">Ambulance</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚒</div>
          <div class="service-info">
            <div class="service-name" style="color: #f97316;">${escapeHtml(nums.fire)}</div>
            <div class="service-meta">Fire</div>
          </div>
        </div>
      </div>
      ${nums.women ? `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <div class="service-card" style="cursor:default;">
            <div style="font-size:20px;">👩</div>
            <div class="service-info">
              <div class="service-name" style="color: #e879f9;">${escapeHtml(nums.women)}</div>
              <div class="service-meta">Women Helpline</div>
            </div>
          </div>
          <div class="service-card" style="cursor:default;">
            <div style="font-size:20px;">🧒</div>
            <div class="service-info">
              <div class="service-name" style="color: #fbbf24;">${escapeHtml(nums.child || '')}</div>
              <div class="service-meta">Child Helpline</div>
            </div>
          </div>
        </div>
      ` : ''}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">⚠️</span> Risk Factors</div>
      <div class="risk-tags">
        ${risks.map(r => `<span class="risk-tag negative">⚠ ${escapeHtml(r)}</span>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🛡️</span> Safety Features</div>
      <div class="risk-tags">
        ${features.map(s => `<span class="risk-tag positive">✓ ${escapeHtml(s)}</span>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📹</span> CCTV Cameras Nearby</div>
      <div class="camera-stats">
        <div class="cam-stat">
          <div class="cam-stat-value">${cameraArray.length}</div>
          <div class="cam-stat-label">Total Cameras</div>
        </div>
        <div class="cam-stat">
          <div class="cam-stat-value">${activeCams.length}</div>
          <div class="cam-stat-label">Active / Online</div>
        </div>
      </div>
      ${cameraArray.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No cameras detected in this area</p>' : ''}
      ${cameraArray.slice(0, 5).map(c => `
        <div class="service-card" onclick="map.flyTo([${safeMapCoordinate(c.lat, -90, 90)}, ${safeMapCoordinate(c.lng, -180, 180)}], 17)" tabindex="0" role="button" aria-label="View ${escapeHtml(c.name)} on map">
          <div class="service-icon" style="background: rgba(34,197,94,0.15); font-size: 18px;">📹</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(c.name)}</div>
            <div class="service-meta">${escapeHtml(c.resolution)} • ${c.status === 'active' ? '<span style="color:#22c55e">● Online</span>' : '<span style="color:#eab308">● Maintenance</span>'}${c.source === 'openstreetmap' ? ' • 📡 OSM' : (c.source === 'google-places' ? ' • 🗺 Google' : ' • ⚠ Est.')}</div>
          </div>
          <div class="service-distance">${formatDistance(c.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚔</span> Nearest Police Stations</div>
      ${services.police.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No police stations found within 3 km</p>' : ''}
      ${services.police.slice(0, 5).map(p => `
        <div class="service-card" onclick="map.flyTo([${safeMapCoordinate(p.lat, -90, 90)}, ${safeMapCoordinate(p.lng, -180, 180)}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(p.name)} on map">
          <div class="service-icon police">🚔</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(p.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(p.phone)}${p.source === 'openstreetmap' ? ' • 📡 Verified' : (p.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.')}</div>
          </div>
          <div class="service-distance">${formatDistance(p.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🏥</span> Nearest Hospitals</div>
      ${services.hospital.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No hospitals found within 3 km</p>' : ''}
      ${services.hospital.slice(0, 5).map(h => `
        <div class="service-card" onclick="map.flyTo([${safeMapCoordinate(h.lat, -90, 90)}, ${safeMapCoordinate(h.lng, -180, 180)}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(h.name)} on map">
          <div class="service-icon hospital">🏥</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(h.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(h.phone)}${h.source === 'openstreetmap' ? ' • 📡 Verified' : (h.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.')}</div>
          </div>
          <div class="service-distance">${formatDistance(h.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚒</span> Nearest Fire Stations</div>
      ${services.fire.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No fire stations found within 3 km</p>' : ''}
      ${services.fire.slice(0, 5).map(f => `
        <div class="service-card" onclick="map.flyTo([${safeMapCoordinate(f.lat, -90, 90)}, ${safeMapCoordinate(f.lng, -180, 180)}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(f.name)} on map">
          <div class="service-icon fire">🚒</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(f.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(f.phone)}${f.source === 'openstreetmap' ? ' • 📡 Verified' : (f.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.')}</div>
          </div>
          <div class="service-distance">${formatDistance(f.distance)}</div>
        </div>
      `).join('')}
    </div>

    <button class="emergency-btn" onclick="alert('Emergency Numbers:\n\n🚨 Unified: ${nums.unified}\n🚔 Police: ${nums.police}\n🚑 Ambulance: ${nums.ambulance}\n🚒 Fire: ${nums.fire}${nums.women ? '\n👩 Women: ' + nums.women : ''}${nums.child ? '\n🧒 Child: ' + nums.child : ''}')" aria-label="Show emergency contact numbers">
      🆘 Emergency Numbers
    </button>
    <button class="emergency-btn secondary" onclick="openEmergencyContacts()" aria-label="Manage emergency contacts">
      📱 Emergency Contacts
    </button>
  `;
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }
}

// ── Time Slider ───────────────────────────────────────────────
async function onTimeChange(value) {
  currentHour = parseInt(value, 10);
  updateTimeDisplay();

  const slider = document.getElementById('timeSlider');
  slider.setAttribute('aria-valuenow', currentHour);

  updateHeatmap();
  refreshSelectedSidebar();

  if (activeRoute && routeDestination) {
    refreshMobilityIntelligence({ notify: false, keepViewport: true });
  }
}

function updateTimeDisplay() {
  document.getElementById('timeDisplay').textContent = formatTime(currentHour);
}

// ── Favorite Locations ────────────────────────────────────────
function persistFavoriteLocations() {
  persistStoredArray(FAVORITES_STORAGE_KEY, favoriteLocations);
}

function toggleFavorite(lat, lng, name) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);

  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng) || safeLat < -90 || safeLat > 90 || safeLng < -180 || safeLng > 180) {
    showNotification('Unable to save this location. Coordinates are invalid.', 'error', 2600);
    return;
  }

  const index = favoriteLocations.findIndex(fav =>
    Math.abs(fav.lat - safeLat) < 0.0001 && Math.abs(fav.lng - safeLng) < 0.0001
  );

  if (index > -1) {
    favoriteLocations.splice(index, 1);
    showNotification('📍 Location removed from favorites', 'info', 2000);
  } else {
    if (favoriteLocations.length >= MAX_FAVORITES) {
      showNotification(`You can store up to ${MAX_FAVORITES} favorite locations.`, 'warning', 2800);
      return;
    }

    favoriteLocations.push({
      lat: safeLat,
      lng: safeLng,
      name: normalizeDisplayText(name, 80) || 'Saved location',
      timestamp: Date.now()
    });
    showNotification('⭐ Location saved to favorites', 'success', 2000);
  }

  persistFavoriteLocations();
  refreshSelectedSidebar();
}

// ── SafeHome Finder ───────────────────────────────────────────
function findSafestHomes() {
  if (!lastFetchedProperties || lastFetchedProperties.length === 0) {
    showNotification('No properties found nearby. Please search a new area.', 'warning');
    return;
  }

  showStatus('Scoring properties for safety...');

  let bestProp = null;
  let bestScore = -1;

  lastFetchedProperties.forEach(prop => {
    const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo, lastRiskData, { lat: prop.lat, lng: prop.lng });
    let propScore = scoreData.score;

    const policeDist = lastFetchedServices.police.length > 0
      ? getDistance(prop.lat, prop.lng, lastFetchedServices.police[0].lat, lastFetchedServices.police[0].lng)
      : 5000;

    if (policeDist < 300) propScore += 12;
    else if (policeDist < 800) propScore += 6;

    if (propScore > bestScore) {
      bestScore = propScore;
      bestProp = prop;
    }
  });

  if (bestProp) {
    setTimeout(() => {
      showStatus('');
      showNotification(`🏆 Safest Home Found! Estimated Score: ${Math.min(100, Math.floor(bestScore))}/100`, 'success', 5000);
      map.flyTo([bestProp.lat, bestProp.lng], 17);

      setTimeout(() => {
        onMapClick({ latlng: { lat: bestProp.lat, lng: bestProp.lng } });
        propertiesLayerGroup.eachLayer(layer => {
          if (layer.getLatLng().lat === bestProp.lat && layer.getLatLng().lng === bestProp.lng) {
            layer.openPopup();
          }
        });
      }, 500);
    }, 1000);
  } else {
    showStatus('');
  }
}

// ── Layer Toggle ──────────────────────────────────────────────
function toggleLayer(type) {
  const btn = document.querySelector(`[data-layer="${type}"]`);

  switch (type) {
    case 'heatmap':
      layerState.heatmap = !layerState.heatmap;
      if (layerState.heatmap) heatLayer.addTo(map);
      else map.removeLayer(heatLayer);
      break;
    case 'cameras':
      layerState.cameras = !layerState.cameras;
      if (layerState.cameras) cameraLayerGroup.addTo(map);
      else map.removeLayer(cameraLayerGroup);
      break;
    case 'emergency':
      layerState.emergency = !layerState.emergency;
      if (layerState.emergency) emergencyLayerGroup.addTo(map);
      else map.removeLayer(emergencyLayerGroup);
      break;
    case 'properties':
      layerState.properties = !layerState.properties;
      if (layerState.properties) propertiesLayerGroup.addTo(map);
      else map.removeLayer(propertiesLayerGroup);
      break;
    case 'risk':
      layerState.risk = !layerState.risk;
      if (layerState.risk) riskLayerGroup.addTo(map);
      else map.removeLayer(riskLayerGroup);
      break;
  }

  if (btn) {
    btn.classList.toggle('active', layerState[type]);
    btn.setAttribute('aria-pressed', layerState[type]);
  }

  const layerName = type.charAt(0).toUpperCase() + type.slice(1);
  showNotification(`${layerState[type] ? '✓' : '✗'} ${layerName} layer ${layerState[type] ? 'enabled' : 'disabled'}`, 'info', 1500);
}

// ── Search + Voice Search ─────────────────────────────────────
function normalizeSearchQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getCountryNameFromCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return '';

  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      const countryName = regionNames.of(normalized);
      if (countryName) return countryName;
    } catch (err) {
      console.warn('Country name lookup failed:', err);
    }
  }

  return normalized;
}

function buildGeocodeQueryVariants(query) {
  const normalized = normalizeSearchQuery(query);
  const variants = [];

  const addVariant = (value) => {
    const candidate = normalizeSearchQuery(value);
    if (!candidate) return;

    const key = candidate.toLowerCase();
    if (!variants.some(item => item.toLowerCase() === key)) {
      variants.push(candidate);
    }
  };

  addVariant(normalized);

  const cleaned = normalized.replace(/[^\w\s,.-]/g, ' ');
  addVariant(cleaned);

  const areaHint = normalizeSearchQuery(lastAreaInfo && lastAreaInfo.area);
  const localityHint = normalizeSearchQuery(lastAreaInfo && lastAreaInfo.name);
  const countryHint = getCountryNameFromCode(typeof currentCountryCode === 'string' ? currentCountryCode : '');

  if (!normalized.includes(',')) {
    if (areaHint) addVariant(`${normalized}, ${areaHint}`);
    if (localityHint && localityHint.toLowerCase() !== areaHint.toLowerCase()) {
      addVariant(`${normalized}, ${localityHint}`);
    }
    if (countryHint) addVariant(`${normalized}, ${countryHint}`);
    if (areaHint) addVariant(`${normalized} near ${areaHint}`);
  }

  if (!/\b(apartment|apartments|apt|residency|residence|society|tower|condo|condominium)\b/i.test(normalized)) {
    addVariant(`${normalized} apartment`);
  }

  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      addVariant(parts.slice(1).join(', '));
      addVariant(parts[parts.length - 1]);
    }
  } else {
    const words = normalized.split(/\s+/);
    if (words.length > 1) {
      addVariant(words.slice(1).join(' '));
      if (words.length > 2) {
        addVariant(words.slice(-2).join(' '));
      }
    }
  }

  return variants.slice(0, 10);
}

function buildSearchViewbox(center, delta = 0.18) {
  if (!Array.isArray(center) || center.length < 2) return '';
  const lat = Number(center[0]);
  const lng = Number(center[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';

  const left = (lng - delta).toFixed(6);
  const top = (lat + delta).toFixed(6);
  const right = (lng + delta).toFixed(6);
  const bottom = (lat - delta).toFixed(6);
  return `${left},${top},${right},${bottom}`;
}

function buildNominatimSearchUrl(query, options = {}) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(options.limit || 5),
    addressdetails: '1',
    dedupe: '1'
  });

  if (options.countryCode && /^[a-z]{2}$/i.test(options.countryCode)) {
    params.set('countrycodes', String(options.countryCode).toLowerCase());
  }

  if (options.bounded && options.viewbox) {
    params.set('viewbox', options.viewbox);
    params.set('bounded', '1');
  }

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

async function fetchNominatimCandidates(query, options = {}) {
  const url = buildNominatimSearchUrl(query, options);
  const request = typeof fetchWithTimeout === 'function'
    ? fetchWithTimeout(url, { headers: { 'Accept-Language': 'en' } }, 9000)
    : fetch(url, { headers: { 'Accept-Language': 'en' } });

  const response = await request;
  if (!response.ok) {
    throw new Error(`Geocode API returned ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function scoreGeocodeCandidate(candidate, baseQuery) {
  const normalizedBase = normalizeSearchQuery(baseQuery).toLowerCase();
  const displayName = String(candidate.display_name || '').toLowerCase();
  const primaryLabel = displayName.split(',')[0].trim();
  const tokens = normalizedBase.split(/\s+/).filter(token => token.length > 2);

  let score = 0;

  if (primaryLabel === normalizedBase) score += 120;
  else if (primaryLabel.startsWith(normalizedBase)) score += 90;
  else if (displayName.includes(normalizedBase)) score += 60;

  let tokenMatches = 0;
  for (const token of tokens) {
    if (displayName.includes(token)) tokenMatches += 1;
  }
  score += tokenMatches * 8;
  if (tokens.length > 0 && tokenMatches === tokens.length) score += 20;

  const importance = Number(candidate.importance);
  if (Number.isFinite(importance)) {
    score += importance * 25;
  }

  const lat = Number(candidate.lat);
  const lng = Number(candidate.lon);
  if (
    typeof getDistance === 'function' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Array.isArray(currentMapCenter) &&
    currentMapCenter.length >= 2
  ) {
    const distanceKm = getDistance(currentMapCenter[0], currentMapCenter[1], lat, lng) / 1000;
    if (Number.isFinite(distanceKm)) {
      score += Math.max(0, 25 - Math.min(25, distanceKm));
    }
  }

  if (candidate._bounded) score += 8;

  const category = `${candidate.class || ''} ${candidate.type || ''}`.toLowerCase();
  if (/building|residential|house|apartments/.test(category)) score += 6;

  return score;
}

async function geocodeQuery(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return null;

  if (typeof geocodeQueryWithGoogle === 'function') {
    try {
      const googleResult = await geocodeQueryWithGoogle(normalizedQuery);
      if (googleResult) return googleResult;
    } catch (err) {
      console.warn('Google geocode lookup failed, falling back to OSM:', err);
      notifyGoogleFallback(err, 'OpenStreetMap geocoding');
    }
  }

  const queryVariants = buildGeocodeQueryVariants(normalizedQuery);
  const countryCode = typeof currentCountryCode === 'string' ? currentCountryCode.toLowerCase() : '';
  const viewbox = buildSearchViewbox(currentMapCenter);
  const plans = [];

  for (const variant of queryVariants.slice(0, 3)) {
    plans.push({
      q: variant,
      limit: 7,
      bounded: Boolean(viewbox),
      viewbox,
      countryCode
    });
  }

  for (const variant of queryVariants) {
    plans.push({
      q: variant,
      limit: 6,
      bounded: false,
      viewbox: '',
      countryCode
    });
  }

  const candidates = [];
  const seen = new Set();

  for (const plan of plans.slice(0, 12)) {
    try {
      const results = await fetchNominatimCandidates(plan.q, plan);
      for (const item of results) {
        const key = String(item.place_id || `${item.lat},${item.lon},${item.display_name}`);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...item, _bounded: plan.bounded });
      }

      if (candidates.length >= 10) break;
    } catch (err) {
      console.warn('Geocode lookup attempt failed:', err);
    }
  }

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map(candidate => ({ candidate, score: scoreGeocodeCandidate(candidate, normalizedQuery) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] && ranked[0].candidate;
  if (!best) return null;

  const lat = Number(best.lat);
  const lng = Number(best.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    label: String(best.display_name || normalizedQuery).split(',')[0],
    fullLabel: String(best.display_name || normalizedQuery)
  };
}

async function searchLocation() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) {
    showNotification('⚠️ Please enter a location to search', 'warning', 2000);
    return;
  }

  const btn = document.querySelector('.search-btn');
  const originalText = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const result = await geocodeQuery(query);

    if (result) {
      map.flyTo([result.lat, result.lng], 15, { duration: 1.5 });
      showNotification(`📍 Found: ${result.label}`, 'success', 3000);

      setTimeout(() => {
        onMapClick({ latlng: { lat: result.lat, lng: result.lng } });
      }, 1600);
    } else {
      showNotification('❌ Location not found. Add city/area, e.g. "Prestige Casabella, Bangalore".', 'error', 3500);
    }
  } catch (err) {
    showNotification('❌ Search failed. Please check your internet connection.', 'error', 3000);
    console.error(err);
  }

  btn.textContent = originalText;
  btn.disabled = false;
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') searchLocation();
}

function handleVoiceCommand(transcript) {
  const text = transcript.trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const searchInput = document.getElementById('searchInput');

  if (lower.startsWith('navigate to ')) {
    const place = text.slice(12).trim();
    searchInput.value = place;
    startDirectionsFromInput();
    return;
  }

  if (lower.startsWith('directions to ')) {
    const place = text.slice(14).trim();
    searchInput.value = place;
    startDirectionsFromInput();
    return;
  }

  if (lower === 'call emergency' || lower === 'sos') {
    triggerSOSCall();
    return;
  }

  searchInput.value = text;
  showNotification(`🎤 Heard: ${text}`, 'success', 2500);
}

function setVoiceSearchState(active) {
  const btn = document.getElementById('voiceSearchBtn');
  if (!btn) return;

  btn.classList.toggle('active', active);
  btn.textContent = active ? '🛑' : '🎤';
  isVoiceListening = active;
}

function toggleVoiceSearch() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) {
    showNotification('Voice recognition is not supported in this browser.', 'warning', 3000);
    return;
  }

  if (isVoiceListening && speechRecognition) {
    speechRecognition.stop();
    return;
  }

  speechRecognition = new SpeechRecognitionCtor();
  speechRecognition.lang = 'en-US';
  speechRecognition.interimResults = true;
  speechRecognition.maxAlternatives = 1;

  let finalTranscript = '';

  speechRecognition.onstart = () => {
    setVoiceSearchState(true);
    showNotification('🎤 Listening... Say a place or say "navigate to ..."', 'info', 2500);
  };

  speechRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      }
    }
  };

  speechRecognition.onerror = (event) => {
    console.warn('Voice recognition error:', event.error);
    if (event.error !== 'no-speech') {
      showNotification('Voice recognition failed. Please try again.', 'error', 2500);
    }
  };

  speechRecognition.onend = () => {
    setVoiceSearchState(false);
    if (finalTranscript.trim()) {
      handleVoiceCommand(finalTranscript.trim());
    }
  };

  speechRecognition.start();
}

// ── Directions + Voice Navigation ─────────────────────────────
function openDirectionsPanel() {
  document.getElementById('directionsPanel').classList.add('open');
  if (activeRoute && routeDestination) {
    startMobilityRefreshLoop();
  }
}

function closeDirectionsPanel() {
  document.getElementById('directionsPanel').classList.remove('open');
  stopMobilityRefreshLoop();
  stopVoiceNavigation();
}

const ROUTE_MODE_LABELS = {
  balanced: 'Balanced',
  fastest: 'Fastest',
  safest: 'Safest',
  'least-congested': 'Low Traffic'
};

function getSelectedRouteMode() {
  const select = document.getElementById('routeModeSelect');
  const value = select ? String(select.value || 'balanced').trim().toLowerCase() : 'balanced';

  if (value === 'fastest' || value === 'safest' || value === 'least-congested') {
    return value;
  }

  return 'balanced';
}

function getRouteModeLabel(mode) {
  const key = String(mode || 'balanced').trim().toLowerCase();
  return ROUTE_MODE_LABELS[key] || ROUTE_MODE_LABELS.balanced;
}

function getEdgeAISignal() {
  if (typeof EdgeAI === 'undefined' || typeof EdgeAI.isActive !== 'function') {
    return { active: false, anomalyScore: 0 };
  }

  const active = Boolean(EdgeAI.isActive());
  const anomalyScore = active && typeof EdgeAI.getAnomalyScore === 'function'
    ? Number(EdgeAI.getAnomalyScore())
    : 0;

  return {
    active,
    anomalyScore: Number.isFinite(anomalyScore) ? Math.max(0, anomalyScore) : 0
  };
}

function getRouteMobilityInsight(route, congestion, mode, edgeAiSignal = { active: false, anomalyScore: 0 }) {
  const routeMode = getRouteModeLabel(mode);
  const level = getCongestionClass(congestion && congestion.level);
  const score = Number.isFinite(congestion && congestion.score) ? Math.round(congestion.score) : 50;
  const edgeScore = Number.isFinite(edgeAiSignal.anomalyScore) ? Math.round(edgeAiSignal.anomalyScore) : 0;
  const isSafer = level === 'low' || routeMode === 'Safest' || (route && Number(route.safetyPenalty || 0) <= 18);
  const headline = isSafer ? 'Safer route selected' : 'Route balanced for time and distance';
  const detailParts = [];

  if (level === 'severe') {
    detailParts.push('Traffic is expected to be heavy along this path.');
  } else if (level === 'high') {
    detailParts.push('This path is likely to slow down during the trip.');
  } else {
    detailParts.push('Traffic pressure looks manageable for this route.');
  }

  if (edgeAiSignal.active && edgeScore > 0) {
    detailParts.push(`Sensor Guardian is active with a ${edgeScore}/100 anomaly score.`);
  }

  const factorList = [];
  if (Array.isArray(congestion && congestion.factors)) {
    congestion.factors.slice(0, 3).forEach((factor) => factorList.push(factor));
  }

  if (edgeAiSignal.active) {
    factorList.push(`Sensor anomaly bias: ${edgeScore}/100`);
  }

  return {
    headline,
    detail: detailParts.join(' '),
    label: `${routeMode} · ${score}/100 congestion`,
    tone: isSafer ? 'safe' : 'alert',
    factors: factorList
  };
}

function getCongestionClass(level) {
  const key = String(level || 'moderate').toLowerCase();
  if (key === 'low' || key === 'high' || key === 'severe') return key;
  return 'moderate';
}

function getCongestionLabel(congestion) {
  if (!congestion || typeof congestion !== 'object') return 'Moderate congestion';

  const level = getCongestionClass(congestion.level);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  const score = Number.isFinite(congestion.score) ? Math.round(congestion.score) : 50;
  return `${levelLabel} congestion (${score}/100)`;
}

function clearRouteDrawing() {
  routeAlternativeLayers.forEach((layer) => {
    if (layer && map && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  });

  routeAlternativeLayers = [];
  routeLayer = null;
}

function getActiveRouteAlternative(route) {
  if (!route || !Array.isArray(route.alternatives) || route.alternatives.length === 0) {
    return null;
  }

  if (route.selectedRouteId) {
    const selected = route.alternatives.find(candidate => candidate.id === route.selectedRouteId);
    if (selected) return selected;
  }

  return route.alternatives[0];
}

function getRouteEtaSeconds(candidate) {
  if (!candidate) return 0;
  const congestion = candidate.congestion || {};
  if (Number.isFinite(congestion.etaSeconds)) {
    return Math.max(Number(candidate.duration || 0), Number(congestion.etaSeconds || 0));
  }
  return Math.max(0, Number(candidate.duration || 0));
}

function getRouteRefreshAgeLabel() {
  if (!lastMobilityRefreshAt) return 'Live update pending';
  const ageSeconds = Math.max(0, Math.round((Date.now() - lastMobilityRefreshAt) / 1000));
  if (ageSeconds <= 1) return 'Updated just now';
  return `Updated ${ageSeconds}s ago`;
}

function syncActiveRouteSelection(routeData, selectedId) {
  if (!routeData || !Array.isArray(routeData.alternatives) || routeData.alternatives.length === 0) {
    return null;
  }

  const selected = routeData.alternatives.find(candidate => candidate.id === selectedId) || routeData.alternatives[0];
  routeData.selectedRouteId = selected.id;
  routeData.selectedIndex = routeData.alternatives.findIndex(candidate => candidate.id === selected.id);
  routeData.distance = selected.distance;
  routeData.duration = selected.duration;
  routeData.path = selected.path;
  routeData.steps = selected.steps;
  routeData.congestion = selected.congestion;
  routeData.etaSeconds = getRouteEtaSeconds(selected);
  return selected;
}

function stopMobilityRefreshLoop() {
  if (mobilityRefreshTimerId !== null) {
    clearInterval(mobilityRefreshTimerId);
    mobilityRefreshTimerId = null;
  }
}

function startMobilityRefreshLoop() {
  stopMobilityRefreshLoop();
  if (!activeRoute || !routeDestination) return;

  mobilityRefreshTimerId = setInterval(() => {
    refreshMobilityIntelligence({ notify: true, keepViewport: true });
  }, MOBILITY_REFRESH_INTERVAL_MS);
}

function refreshMobilityIntelligence(options = {}) {
  if (!activeRoute || !routeDestination || !Array.isArray(activeRoute.alternatives) || activeRoute.alternatives.length === 0) {
    return false;
  }

  if (typeof optimizeRouteAlternatives !== 'function') {
    return false;
  }

  const selectedRouteId = String(activeRoute.selectedRouteId || '');
  const mode = activeRoute.optimizationMode || getSelectedRouteMode();
  const edgeAiSignal = getEdgeAISignal();

  const baseAlternatives = activeRoute.alternatives.map((candidate, index) => ({
    id: String(candidate.id || `route_${index + 1}`),
    label: String(candidate.label || `Route ${String.fromCharCode(65 + (index % 26))}`),
    source: String(candidate.source || activeRoute.source || 'mobility-refresh'),
    distance: Math.max(0, Number(candidate.distance || 0)),
    duration: Math.max(0, Number(candidate.duration || 0)),
    path: Array.isArray(candidate.path) ? candidate.path : [],
    steps: Array.isArray(candidate.steps) ? candidate.steps : []
  })).filter(candidate => candidate.path.length > 1 || candidate.steps.length > 0);

  if (!baseAlternatives.length) {
    return false;
  }

  const optimized = optimizeRouteAlternatives(baseAlternatives, mode, 'driving', {
    hour: currentHour,
    riskData: lastRiskData,
    edgeAiScore: edgeAiSignal.anomalyScore,
    edgeAiActive: edgeAiSignal.active
  });

  if (!optimized || !Array.isArray(optimized.alternatives) || optimized.alternatives.length === 0) {
    return false;
  }

  activeRoute.optimizationMode = optimized.mode;
  activeRoute.alternatives = optimized.alternatives;

  const preferredSelection = activeRoute.alternatives.some(candidate => candidate.id === selectedRouteId)
    ? selectedRouteId
    : optimized.selectedRouteId;

  const activeCandidate = syncActiveRouteSelection(activeRoute, preferredSelection);
  if (!activeCandidate) {
    return false;
  }

  lastMobilityRefreshAt = Date.now();

  const recommendedCandidate = activeRoute.alternatives[0] || activeCandidate;
  const etaGainSeconds = Math.max(0, getRouteEtaSeconds(activeCandidate) - getRouteEtaSeconds(recommendedCandidate));
  const shouldSuggestSwitch =
    Boolean(recommendedCandidate) &&
    recommendedCandidate.id !== activeCandidate.id &&
    etaGainSeconds >= MOBILITY_SWITCH_MIN_GAIN_SECONDS;

  if (options.notify && shouldSuggestSwitch) {
    const now = Date.now();
    if (
      now - lastMobilitySuggestionAt >= MOBILITY_NOTIFICATION_COOLDOWN_MS ||
      lastMobilitySuggestedRouteId !== recommendedCandidate.id
    ) {
      showNotification(
        `⚡ Better route detected: ${recommendedCandidate.label} can save ${formatDuration(etaGainSeconds)}.`,
        'info',
        4200
      );
      lastMobilitySuggestionAt = now;
      lastMobilitySuggestedRouteId = recommendedCandidate.id;
    }
  }

  if (options.redraw !== false) {
    drawRoute(activeRoute, { preserveViewport: options.keepViewport !== false });
  }

  renderDirectionsPanel(activeRoute, routeDestination.label);
  return true;
}

function refreshMobilityInsightNow() {
  const refreshed = refreshMobilityIntelligence({ notify: false, keepViewport: true });
  if (!refreshed) {
    showNotification('No active route is available to refresh.', 'warning', 2200);
    return;
  }

  showNotification('Mobility insight refreshed.', 'success', 1800);
}

function applyRecommendedRoute() {
  if (!activeRoute || !Array.isArray(activeRoute.alternatives) || activeRoute.alternatives.length === 0) {
    showNotification('Create a route first to apply AI recommendation.', 'warning', 2500);
    return;
  }

  const recommended = activeRoute.alternatives.find(candidate => candidate.isRecommended) || activeRoute.alternatives[0];
  if (!recommended) {
    showNotification('No AI recommendation is available right now.', 'warning', 2200);
    return;
  }

  if (recommended.id === activeRoute.selectedRouteId) {
    showNotification('You are already on the best available route.', 'success', 1800);
    return;
  }

  selectRouteAlternative(recommended.id);
}

function getCurrentLocation() {
  const mapCenterFallback = {
    lat: currentMapCenter[0],
    lng: currentMapCenter[1],
    source: 'map-center'
  };

  return new Promise((resolve) => {
    let settled = false;
    let fallbackTimerId = null;

    const resolveOnce = (value) => {
      if (settled) return false;
      settled = true;

      if (fallbackTimerId !== null) {
        clearTimeout(fallbackTimerId);
        fallbackTimerId = null;
      }

      resolve(value);
      return true;
    };

    const resolveWithGoogleApproximation = async () => {
      if (settled) return true;
      if (typeof fetchApproximateLocationFromGoogle !== 'function') return false;

      try {
        const approx = await fetchApproximateLocationFromGoogle();
        if (settled) return true;

        if (approx && Number.isFinite(approx.lat) && Number.isFinite(approx.lng)) {
          const accuracyNote = approx.accuracy
            ? ` (~${Math.round(approx.accuracy)}m accuracy)`
            : '';
          showNotification(`Using approximate Google location${accuracyNote} as start point.`, 'warning', 4200);
          return resolveOnce({ lat: approx.lat, lng: approx.lng, source: 'google-approximate' });
        }
      } catch (err) {
        if (!settled) {
          console.warn('Google approximate location failed:', err);
          notifyGoogleFallback(err, 'map center location fallback');
        }
      }

      return false;
    };

    if (!navigator.geolocation) {
      resolveWithGoogleApproximation().then((resolvedFromGoogle) => {
        if (resolvedFromGoogle) return;

        showNotification('Geolocation is unavailable. Using current map center as start point.', 'warning', 4000);
        resolveOnce(mapCenterFallback);
      });
      return;
    }

    // Do not block route startup for long geolocation timeouts.
    fallbackTimerId = setTimeout(() => {
      resolveWithGoogleApproximation().then((resolvedFromGoogle) => {
        if (resolvedFromGoogle) return;
        showNotification('Location lookup is slow. Using current map center as start point.', 'warning', 3600);
        resolveOnce(mapCenterFallback);
      });
    }, 3200);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        resolveOnce({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device' });
      },
      async (error) => {
        if (settled) return;

        const resolvedFromGoogle = await resolveWithGoogleApproximation();
        if (resolvedFromGoogle) return;

        const code = error && typeof error.code === 'number' ? error.code : 0;
        let message = 'Unable to access your location.';
        if (code === 1) {
          message = 'Location permission denied.';
        } else if (code === 2) {
          message = 'Location signal is unavailable.';
        } else if (code === 3) {
          message = 'Location request timed out.';
        }

        showNotification(`${message} Using current map center as start point.`, 'warning', 4000);
        resolveOnce(mapCenterFallback);
      },
      {
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 15000
      }
    );
  });
}

function renderDirectionsPanel(route, destinationLabel) {
  const content = document.getElementById('directionsContent');
  if (!content) return;

  const alternatives = Array.isArray(route.alternatives) && route.alternatives.length > 0
    ? route.alternatives
    : [{
      id: 'route_primary',
      label: 'Primary route',
      distance: route.distance,
      duration: route.duration,
      path: route.path,
      steps: route.steps,
      congestion: route.congestion || { level: 'moderate', score: 50, delaySeconds: 0, etaSeconds: route.duration, confidence: 'low' }
    }];

  const activeCandidate = getActiveRouteAlternative({ ...route, alternatives });
  if (!activeCandidate) {
    content.innerHTML = '<p class="directions-empty">No route candidates are available right now.</p>';
    return;
  }

  const activeCongestion = activeCandidate.congestion || { level: 'moderate', score: 50, delaySeconds: 0, etaSeconds: activeCandidate.duration };
  const edgeAiSignal = getEdgeAISignal();
  const mobilityInsight = getRouteMobilityInsight(activeCandidate, activeCongestion, route.optimizationMode || getSelectedRouteMode(), edgeAiSignal);
  const delaySeconds = Number.isFinite(activeCongestion.delaySeconds) ? Math.max(0, activeCongestion.delaySeconds) : 0;
  const etaSeconds = Number.isFinite(activeCongestion.etaSeconds)
    ? Math.max(activeCandidate.duration || 0, activeCongestion.etaSeconds)
    : (activeCandidate.duration || 0);
  const recommendedCandidate = alternatives.find(candidate => candidate.isRecommended) || alternatives[0] || activeCandidate;
  const etaGainSeconds = Math.max(0, getRouteEtaSeconds(activeCandidate) - getRouteEtaSeconds(recommendedCandidate));
  const shouldSwitch =
    recommendedCandidate &&
    recommendedCandidate.id !== activeCandidate.id &&
    etaGainSeconds >= MOBILITY_SWITCH_MIN_GAIN_SECONDS;
  const actionSummary = shouldSwitch
    ? `Switch to ${recommendedCandidate.label} to save about ${formatDuration(etaGainSeconds)}.`
    : 'Stay on the current route. It is already the best option right now.';
  const actionMeta = `${getRouteRefreshAgeLabel()} • Sensor Guardian ${edgeAiSignal.active ? 'active' : 'inactive'}`;

  const stepsMarkup = (Array.isArray(activeCandidate.steps) ? activeCandidate.steps : []).slice(0, 20).map((step, idx) => `
    <div class="direction-step" id="route-step-${idx}">
      <div class="direction-step-index">${idx + 1}</div>
      <div class="direction-step-text">
        <div class="direction-instruction">${escapeHtml(step.instruction)}</div>
        <div class="direction-meta">${formatDistance(step.distance)} • ${formatDuration(step.duration)}</div>
      </div>
    </div>
  `).join('');

  const optionCardsMarkup = alternatives.map((candidate) => {
    const candidateCongestion = candidate.congestion || { level: 'moderate', score: 50, delaySeconds: 0, etaSeconds: candidate.duration };
    const candidateDelay = Number.isFinite(candidateCongestion.delaySeconds) ? Math.max(0, candidateCongestion.delaySeconds) : 0;
    const candidateEta = Number.isFinite(candidateCongestion.etaSeconds)
      ? Math.max(candidate.duration || 0, candidateCongestion.etaSeconds)
      : (candidate.duration || 0);
    const isActive = candidate.id === activeCandidate.id;
    const recommended = candidate.isRecommended ? '<span class="route-reco">Best</span>' : '';
    const scoreText = Number.isFinite(candidate.optimizationScore)
      ? `Opt score ${candidate.optimizationScore.toFixed(2)}`
      : '';

    return `
      <button class="route-option ${isActive ? 'active' : ''}" onclick="selectRouteAlternative('${escapeJsString(candidate.id)}')" aria-label="Use ${escapeHtml(candidate.label)}">
        <div class="route-option-header">
          <span class="route-option-title">${escapeHtml(candidate.label || 'Route')}</span>
          ${recommended}
        </div>
        <div class="route-option-meta">
          ${formatDuration(candidate.duration)} base • ${formatDuration(candidateDelay)} delay • ETA ${formatDuration(candidateEta)}
        </div>
        <div class="route-option-meta">
          <span class="congestion-pill ${getCongestionClass(candidateCongestion.level)}">${escapeHtml(getCongestionLabel(candidateCongestion))}</span>
          ${scoreText ? `<span class="route-option-score">${escapeHtml(scoreText)}</span>` : ''}
        </div>
      </button>
    `;
  }).join('');

  const insightTagsMarkup = (mobilityInsight.factors || []).map((factor) => `
    <span class="route-insight-tag">${escapeHtml(factor)}</span>
  `).join('');

  content.innerHTML = `
    <div class="directions-summary">
      <div class="directions-destination">📍 ${escapeHtml(destinationLabel)}</div>
      <div class="directions-stats">${formatDistance(activeCandidate.distance)} • ${formatDuration(activeCandidate.duration)} • ${(activeCandidate.steps || []).length} steps</div>
      <div class="directions-mode">Mode: ${escapeHtml(getRouteModeLabel(route.optimizationMode || getSelectedRouteMode()))}</div>
      <div class="directions-prediction">
        <span class="congestion-pill ${getCongestionClass(activeCongestion.level)}">${escapeHtml(getCongestionLabel(activeCongestion))}</span>
        <span>Predicted delay ${formatDuration(delaySeconds)} • ETA ${formatDuration(etaSeconds)}</span>
      </div>
      <div class="route-insight-card route-insight-${mobilityInsight.tone}">
        <div class="route-insight-head">
          <span class="route-insight-title">Mobility Insight</span>
          <span class="route-insight-badge">${escapeHtml(mobilityInsight.label)}</span>
        </div>
        <div class="route-insight-summary">${escapeHtml(mobilityInsight.headline)}</div>
        <div class="route-insight-detail">${escapeHtml(mobilityInsight.detail)}</div>
        <div class="route-insight-tags">${insightTagsMarkup || '<span class="route-insight-tag">No additional risk factors detected</span>'}</div>
      </div>
      <div class="route-action-card ${shouldSwitch ? 'urgent' : 'stable'}">
        <div class="route-action-title">Actionable Output</div>
        <div class="route-action-text">${escapeHtml(actionSummary)}</div>
        <div class="route-action-meta">${escapeHtml(actionMeta)}</div>
        ${shouldSwitch
    ? '<button class="search-btn directions-btn ai-action-btn" onclick="applyRecommendedRoute()" aria-label="Apply AI recommended route change for better safety">⚡ Apply AI Recommendation</button>'
    : '<button class="search-btn ai-action-btn ai-action-secondary" onclick="refreshMobilityInsightNow()" aria-label="Refresh mobility insight and re-evaluate route conditions">↻ Refresh Mobility Insight</button>'}
      </div>
      <div class="route-options">${optionCardsMarkup}</div>
      <div class="directions-actions">
        <button class="search-btn" onclick="speakRouteOverview()" aria-label="Listen to route overview using text to speech">🔊 Speak Overview</button>
        <button class="search-btn directions-btn" onclick="startVoiceNavigation()" aria-label="Activate voice-guided turn-by-turn navigation">🎙 Start Voice Guidance</button>
        <button class="search-btn" onclick="stopVoiceNavigation()" aria-label="Stop voice navigation">⏹ Stop</button>
      </div>
    </div>
    <div class="directions-steps">${stepsMarkup}</div>
  `;
}

function drawRoute(routeData, options = {}) {
  clearRouteDrawing();

  const alternatives = Array.isArray(routeData && routeData.alternatives) && routeData.alternatives.length > 0
    ? routeData.alternatives
    : [{ id: 'route_primary', path: routeData && routeData.path ? routeData.path : [], congestion: routeData ? routeData.congestion : null }];
  const selectedRouteId = routeData && routeData.selectedRouteId
    ? routeData.selectedRouteId
    : (alternatives[0] && alternatives[0].id ? alternatives[0].id : 'route_primary');

  alternatives.forEach((candidate) => {
    if (!Array.isArray(candidate.path) || candidate.path.length < 2) return;

    const isActive = candidate.id === selectedRouteId;
    const congestionLevel = getCongestionClass(candidate.congestion && candidate.congestion.level);
    const inactiveColor = congestionLevel === 'severe'
      ? '#ef4444'
      : congestionLevel === 'high'
        ? '#f97316'
        : congestionLevel === 'low'
          ? '#22c55e'
          : '#eab308';

    const polyline = L.polyline(candidate.path, {
      color: isActive ? '#38bdf8' : inactiveColor,
      weight: isActive ? 6 : 4,
      opacity: isActive ? 0.95 : 0.46,
      lineJoin: 'round',
      dashArray: isActive ? null : '8 10',
      interactive: false
    }).addTo(map);

    routeAlternativeLayers.push(polyline);
    if (isActive) routeLayer = polyline;
  });

  const focusLayer = routeLayer || routeAlternativeLayers[0];
  if (focusLayer && !options.preserveViewport) {
    map.fitBounds(focusLayer.getBounds(), { padding: [60, 60] });
  }
}

function selectRouteAlternative(routeId) {
  if (!activeRoute || !Array.isArray(activeRoute.alternatives) || activeRoute.alternatives.length === 0) {
    return;
  }

  const nextRoute = activeRoute.alternatives.find(candidate => candidate.id === routeId);
  if (!nextRoute) return;

  stopVoiceNavigation(false);

  activeRoute.selectedRouteId = nextRoute.id;
  activeRoute.selectedIndex = activeRoute.alternatives.findIndex(candidate => candidate.id === nextRoute.id);
  activeRoute.distance = nextRoute.distance;
  activeRoute.duration = nextRoute.duration;
  activeRoute.path = nextRoute.path;
  activeRoute.steps = nextRoute.steps;
  activeRoute.congestion = nextRoute.congestion;
  activeRoute.etaSeconds = getRouteEtaSeconds(nextRoute);
  lastMobilityRefreshAt = Date.now();
  lastMobilitySuggestedRouteId = '';

  routeStepIndex = 0;
  drawRoute(activeRoute);

  if (routeDestination) {
    renderDirectionsPanel(activeRoute, routeDestination.label);
  }

  showNotification(`Switched to ${nextRoute.label || 'selected route'} (${getCongestionLabel(nextRoute.congestion)})`, 'info', 2300);
}

async function startDirectionsTo(lat, lng, label = 'Destination') {
  showStatus('Calculating route...');

  try {
    const origin = await getCurrentLocation();
    const routeMode = getSelectedRouteMode();
    const edgeAiSignal = getEdgeAISignal();
    const route = await fetchRouteDirections(origin.lat, origin.lng, lat, lng, 'driving', {
      mode: routeMode,
      hour: currentHour,
      riskData: lastRiskData,
      edgeAiScore: edgeAiSignal.anomalyScore,
      edgeAiActive: edgeAiSignal.active
    });

    activeRoute = route;
    routeDestination = { lat, lng, label };
    routeStepIndex = 0;
    lastMobilityRefreshAt = Date.now();
    lastMobilitySuggestionAt = 0;
    lastMobilitySuggestedRouteId = '';

    drawRoute(route);
    renderDirectionsPanel(route, label);
    openDirectionsPanel();
    startMobilityRefreshLoop();

    if (route.error) {
      showNotification('⚠️ Live routing unavailable. Showing direct fallback line.', 'warning', 4000);
    } else if (route.source === 'google-directions-sdk') {
      showNotification(`🧭 ${getRouteModeLabel(route.optimizationMode)} route ready via Google to ${label}`, 'success', 2600);
    } else {
      showNotification(`🧭 ${getRouteModeLabel(route.optimizationMode)} route ready to ${label}`, 'success', 2600);
    }
  } catch (err) {
    console.error('Directions error:', err);
    showNotification('❌ Could not build directions. Please try again.', 'error', 4000);
  }

  showStatus('');
}

async function startDirectionsFromInput() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) {
    showNotification('⚠️ Enter or speak a destination first.', 'warning', 2500);
    return;
  }

  showStatus('Finding destination...');
  try {
    const result = await geocodeQuery(query);
    if (!result) {
      showNotification('❌ Destination not found. Try adding area/city in the search text.', 'error', 3200);
      showStatus('');
      return;
    }

    map.flyTo([result.lat, result.lng], 15, { duration: 1.2 });
    setTimeout(() => {
      startDirectionsTo(result.lat, result.lng, result.label);
    }, 1000);
  } catch (err) {
    console.error('Destination lookup failed:', err);
    showNotification('❌ Destination lookup failed.', 'error', 3000);
  }
  showStatus('');
}

function speakText(text, interrupt = false) {
  if (!('speechSynthesis' in window)) {
    showNotification('Voice guidance is not supported in this browser.', 'warning', 3000);
    return;
  }

  if (interrupt) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function speakRouteOverview() {
  if (!activeRoute || !routeDestination) {
    showNotification('No active route to narrate.', 'warning', 2000);
    return;
  }

  const congestion = activeRoute.congestion || {};
  const level = getCongestionClass(congestion.level);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  const etaSeconds = Number.isFinite(congestion.etaSeconds)
    ? Math.max(activeRoute.duration || 0, congestion.etaSeconds)
    : activeRoute.duration;

  const summary = `Route to ${routeDestination.label}. Distance ${formatDistance(activeRoute.distance)}. Base travel time ${formatDuration(activeRoute.duration)}. Predicted traffic ${levelLabel}. Estimated arrival in ${formatDuration(etaSeconds)}.`;
  speakText(summary, true);
}

function highlightCurrentRouteStep(index) {
  const allSteps = document.querySelectorAll('.direction-step');
  allSteps.forEach(step => step.classList.remove('active'));

  const target = document.getElementById(`route-step-${index}`);
  if (target) {
    target.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function startVoiceNavigation() {
  if (!activeRoute || !routeDestination || !activeRoute.steps.length) {
    showNotification('Create a route first to start voice guidance.', 'warning', 2500);
    return;
  }

  if (!navigator.geolocation) {
    showNotification('Geolocation is not available. Reading route steps instead.', 'warning', 3500);
    const preview = activeRoute.steps.slice(0, 8).map(s => s.voiceInstruction).join(' Then, ');
    speakText(preview, true);
    return;
  }

  stopVoiceNavigation(false);
  routeStepIndex = 0;
  highlightCurrentRouteStep(0);
  speakText('Voice guidance started. ' + activeRoute.steps[0].voiceInstruction, true);

  navigationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const userLat = position.coords.latitude;
      const userLng = position.coords.longitude;

      if (routeStepIndex < activeRoute.steps.length) {
        const step = activeRoute.steps[routeStepIndex];
        const stepDistance = getDistance(userLat, userLng, step.lat, step.lng);

        if (stepDistance <= 55) {
          speakText(step.voiceInstruction, true);
          highlightCurrentRouteStep(routeStepIndex);
          routeStepIndex += 1;
        }
      }

      const destinationDistance = getDistance(userLat, userLng, routeDestination.lat, routeDestination.lng);
      if (destinationDistance <= 45) {
        speakText('You have arrived at your destination.', true);
        stopVoiceNavigation(false);
      }
    },
    () => {
      showNotification('Unable to track your location for voice navigation.', 'error', 3000);
      stopVoiceNavigation(false);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000
    }
  );

  showNotification('🎙 Voice guidance active', 'success', 2000);
}

function stopVoiceNavigation(notify = true) {
  if (navigationWatchId !== null) {
    navigator.geolocation.clearWatch(navigationWatchId);
    navigationWatchId = null;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  if (notify) {
    showNotification('Voice guidance stopped.', 'info', 1500);
  }
}

// ── Emergency Contacts ────────────────────────────────────────
function persistEmergencyContacts() {
  persistStoredArray(CONTACTS_STORAGE_KEY, emergencyContacts);
}

function renderEmergencyContacts() {
  const list = document.getElementById('contactsList');
  if (!list) return;

  if (!emergencyContacts.length) {
    list.innerHTML = '<p class="contacts-empty">No emergency contacts added yet.</p>';
    return;
  }

  list.innerHTML = emergencyContacts.map(contact => `
    <div class="contact-row">
      <div class="contact-meta">
        <div class="contact-name">${escapeHtml(contact.name)}</div>
        <div class="contact-phone">${escapeHtml(contact.phone)}</div>
      </div>
      <div class="contact-actions">
        <button class="contact-action call" onclick="callEmergencyContact('${escapeJsString(contact.id)}')" aria-label="Call ${escapeHtml(contact.name)} at ${escapeHtml(contact.phone)}">Call</button>
        <button class="contact-action remove" onclick="removeEmergencyContact('${escapeJsString(contact.id)}')" aria-label="Remove ${escapeHtml(contact.name)} from emergency contacts">Remove</button>
      </div>
    </div>
  `).join('');
}

function openEmergencyContacts() {
  const modal = document.getElementById('contactsModal');
  modal.classList.add('open');
  renderEmergencyContacts();
}

function closeEmergencyContacts() {
  const modal = document.getElementById('contactsModal');
  modal.classList.remove('open');
}

function saveEmergencyContact(event) {
  event.preventDefault();

  const nameInput = document.getElementById('contactNameInput');
  const phoneInput = document.getElementById('contactPhoneInput');
  const name = normalizeDisplayText(nameInput.value, 40);
  const phone = sanitizePhoneNumber(phoneInput.value.trim());

  if (!name || !isValidPhoneNumber(phone)) {
    showNotification('Enter a valid contact name and phone number.', 'warning', 2500);
    return;
  }

  if (emergencyContacts.length >= MAX_EMERGENCY_CONTACTS) {
    showNotification(`You can store up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.`, 'warning', 3000);
    return;
  }

  if (emergencyContacts.some((contact) => sanitizePhoneNumber(contact.phone) === phone)) {
    showNotification('This phone number is already saved as an emergency contact.', 'warning', 2600);
    return;
  }

  emergencyContacts.push({
    id: `contact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    phone
  });

  persistEmergencyContacts();
  renderEmergencyContacts();

  nameInput.value = '';
  phoneInput.value = '';
  showNotification('Emergency contact saved.', 'success', 2000);
}

function removeEmergencyContact(id) {
  emergencyContacts = emergencyContacts.filter(contact => contact.id !== id);
  persistEmergencyContacts();
  renderEmergencyContacts();
  showNotification('Emergency contact removed.', 'info', 1500);
}

function callEmergencyContact(id) {
  const contact = emergencyContacts.find(c => c.id === id);
  if (!contact) return;

  const phone = sanitizePhoneNumber(contact.phone);
  if (!isValidPhoneNumber(phone)) {
    showNotification('This contact has an invalid phone number.', 'error', 2200);
    return;
  }

  window.location.href = `tel:${phone}`;
}

function triggerSOSCall() {
  if (!emergencyContacts.length) {
    showNotification('Add at least one emergency contact first.', 'warning', 2500);
    openEmergencyContacts();
    return;
  }

  const primary = emergencyContacts[0];
  const phone = sanitizePhoneNumber(primary.phone);
  if (!isValidPhoneNumber(phone)) {
    showNotification('Primary contact phone number is invalid.', 'error', 2200);
    return;
  }

  showNotification(`Calling ${primary.name}...`, 'warning', 2000);
  window.location.href = `tel:${phone}`;
}

// ── Edge AI UI Logic ──────────────────────────────────────────
async function toggleEdgeAI() {
  const btn = document.getElementById('edgeAIBtn');
  const isActive = await EdgeAI.toggle();

  if (isActive) {
    btn.classList.add('active');
    btn.innerHTML = '🛡️ Guardian Active<div class="pulse-ring"></div>';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '🛡️ Sensor Guardian';
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderEmergencyContacts();
  persistFavoriteLocations();
  persistEmergencyContacts();

  const contactsModal = document.getElementById('contactsModal');
  contactsModal.addEventListener('click', (event) => {
    if (event.target === contactsModal) {
      closeEmergencyContacts();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeEmergencyContacts();
      closeDirectionsPanel();
    }
  });

  if (typeof EdgeAI !== 'undefined') {
    EdgeAI.subscribe(() => {
      refreshSelectedSidebar();
      if (activeRoute && routeDestination) {
        refreshMobilityIntelligence({ notify: false, keepViewport: true });
      }
    });
  }

  const routeModeSelect = document.getElementById('routeModeSelect');
  if (routeModeSelect) {
    routeModeSelect.addEventListener('change', () => {
      if (!activeRoute || !routeDestination) return;

      activeRoute.optimizationMode = getSelectedRouteMode();
      refreshMobilityIntelligence({ notify: false, keepViewport: true });
      showNotification(`Updated route mode: ${getRouteModeLabel(activeRoute.optimizationMode)}.`, 'info', 2200);
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
});
