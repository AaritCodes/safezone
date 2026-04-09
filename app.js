// ============================================================
// SafeZone — Core Application Logic (API-Powered)
// ============================================================

let map, heatLayer, selectedMarker;
let emergencyLayerGroup, cameraLayerGroup, propertiesLayerGroup;
let currentHour = new Date().getHours();
let layerState = { heatmap: true, cameras: true, emergency: true, properties: true };
let currentMapCenter = MAP_CENTER;
let lastFetchedServices = null;
let lastFetchedCameras = [];
let lastFetchedProperties = [];
let lastAreaInfo = null;
let isFetching = false;
let hasApiErrors = false;
let favoriteLocations = JSON.parse(localStorage.getItem('safezoneFavorites') || '[]');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeServiceType(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'hospital') return 'hospital';
  if (normalized === 'fire' || normalized === 'fire_station') return 'fire';
  return 'police';
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(String(url || ''), window.location.href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (err) {
    console.warn('Invalid URL provided:', err);
  }
  return 'about:blank';
}

function nearestDistance(items, lat, lng) {
  if (!Array.isArray(items) || items.length === 0) return Infinity;
  let nearest = Infinity;

  items.forEach(item => {
    const itemLat = toFiniteNumber(item.lat, NaN);
    const itemLng = toFiniteNumber(item.lng, NaN);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return;
    const dist = getDistance(lat, lng, itemLat, itemLng);
    if (dist < nearest) nearest = dist;
  });

  return nearest;
}

function countNearbyActiveCameras(cameras, lat, lng, radius = 350) {
  if (!Array.isArray(cameras) || cameras.length === 0) return 0;
  return cameras.filter(cam => {
    const camLat = toFiniteNumber(cam.lat, NaN);
    const camLng = toFiniteNumber(cam.lng, NaN);
    if (!Number.isFinite(camLat) || !Number.isFinite(camLng)) return false;
    if (String(cam.status || '').toLowerCase() !== 'active') return false;
    return getDistance(lat, lng, camLat, camLng) <= radius;
  }).length;
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
    maxZoom: 19,
  }).addTo(map);

  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('© OpenStreetMap contributors | SafeZone')
    .addTo(map);

  // Initialize empty layer groups
  emergencyLayerGroup = L.layerGroup().addTo(map);
  cameraLayerGroup = L.layerGroup().addTo(map);
  propertiesLayerGroup = L.layerGroup().addTo(map);

  // Heatmap
  initHeatmap();

  // Map click
  map.on('click', onMapClick);

  // Set time slider
  const slider = document.getElementById('timeSlider');
  slider.value = currentHour;
  slider.setAttribute('aria-label', 'Time of day slider');
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', '23');
  slider.setAttribute('aria-valuenow', currentHour);
  updateTimeDisplay();

  // Load initial area data
  loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);

  // Hide loading
  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 1500);
}

// ── Load area data from APIs ──────────────────────────────────
async function loadAreaData(lat, lng) {
  if (isFetching) return;
  isFetching = true;
  hasApiErrors = false;

  showStatus('Scanning area...');

  try {
    // Fetch services, cameras, properties, and area info in parallel
    const [services, cameras, properties, areaInfo] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      fetchNearbyProperties(lat, lng, 2000),
      reverseGeocode(lat, lng)
    ]);

    // Check for API errors
    if (services.error || cameras.error || areaInfo.error) {
      hasApiErrors = true;
      showNotification('⚠️ Using estimated data - API temporarily unavailable', 'warning', 5000);
    }

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    currentMapCenter = [lat, lng];

    // Update map markers
    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);
    updatePropertyMarkers(lastFetchedProperties);
    updateHeatmap();

    showStatus('');
  } catch (err) {
    console.error('Failed to load area data:', err);
    showNotification('❌ Failed to load area data. Please try again.', 'error', 5000);
    showStatus('');
  }

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
    radius: 35, blur: 25, maxZoom: 17, max: 1.0,
    gradient: { 0.0: '#22c55e33', 0.2: '#22c55e', 0.4: '#eab308', 0.6: '#f97316', 0.8: '#ef4444', 1.0: '#dc2626' }
  }).addTo(map);
}

function updateHeatmap() {
  if (heatLayer) map.removeLayer(heatLayer);
  const data = getHeatmapData(currentHour, currentMapCenter);
  heatLayer = L.heatLayer(data, {
    radius: 35, blur: 25, maxZoom: 17, max: 1.0,
    gradient: { 0.0: '#22c55e33', 0.2: '#22c55e', 0.4: '#eab308', 0.6: '#f97316', 0.8: '#ef4444', 1.0: '#dc2626' }
  });
  if (layerState.heatmap) heatLayer.addTo(map);
}

// ── Emergency Service Markers ─────────────────────────────────
function updateEmergencyMarkers(services) {
  emergencyLayerGroup.clearLayers();

  const safeServices = services || {};
  const policeServices = Array.isArray(safeServices.police) ? safeServices.police : [];
  const hospitalServices = Array.isArray(safeServices.hospital) ? safeServices.hospital : [];
  const fireServices = Array.isArray(safeServices.fire) ? safeServices.fire : [];

  const allServices = [
    ...policeServices,
    ...hospitalServices,
    ...fireServices
  ];

  allServices.forEach(service => {
    const safeType = normalizeServiceType(service.type);
    const lat = toFiniteNumber(service.lat, NaN);
    const lng = toFiniteNumber(service.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const iconClass = safeType === 'police' ? 'marker-police' :
                      safeType === 'hospital' ? 'marker-hospital' : 'marker-fire';
    const emoji = safeType === 'police' ? '🚔' :
                  safeType === 'hospital' ? '🏥' : '🚒';

    const icon = L.divIcon({
      html: `<div class="custom-marker ${iconClass}">${emoji}</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([lat, lng], { icon })
      .bindPopup(createServicePopup({ ...service, type: safeType, lat, lng }));

    emergencyLayerGroup.addLayer(marker);
  });

  if (!layerState.emergency) map.removeLayer(emergencyLayerGroup);
}

function createServicePopup(service) {
  const safeType = normalizeServiceType(service.type);
  const typeLabel = safeType.charAt(0).toUpperCase() + safeType.slice(1);
  const safeName = escapeHtml(service.name || `${typeLabel} Service`);
  const safeAddress = service.address ? escapeHtml(service.address) : '';
  const safePhone = escapeHtml(service.phone || 'N/A');
  const safeDistance = formatDistance(Math.max(0, Math.round(toFiniteNumber(service.distance, 0))));
  const sourceTag = service.source === 'openstreetmap'
    ? '<div style="font-size:10px;color:#64748b;margin-top:6px;">📡 Verified via OpenStreetMap</div>'
    : '<div style="font-size:10px;color:#eab308;margin-top:6px;">⚠ Estimated location</div>';

  return `
    <div>
      <div class="popup-title">${safeName}</div>
      <span class="popup-type ${safeType}">${typeLabel}</span>
      ${safeAddress ? `<div class="popup-row"><span class="label">📍 Addr</span> ${safeAddress}</div>` : ''}
      <div class="popup-row"><span class="label">📞 Phone</span> <strong>${safePhone}</strong></div>
      <div class="popup-row"><span class="label">📏 Dist</span> ${safeDistance}</div>
      ${sourceTag}
    </div>
  `;
}

// ── Camera Markers ────────────────────────────────────────────
function updateCameraMarkers(cameras) {
  cameraLayerGroup.clearLayers();
  
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);

  cameraArray.forEach(cam => {
    const lat = toFiniteNumber(cam.lat, NaN);
    const lng = toFiniteNumber(cam.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const isActive = String(cam.status || '').toLowerCase() === 'active';
    const coverage = Math.max(50, Math.round(toFiniteNumber(cam.coverage, 120)));

    const icon = L.divIcon({
      html: `<div class="custom-marker marker-camera" style="opacity: ${isActive ? '1' : '0.5'}" role="img" aria-label="CCTV Camera">📹</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lng], { icon })
      .bindPopup(createCameraPopup({ ...cam, lat, lng, status: isActive ? 'active' : 'maintenance', coverage }));

    const circle = L.circle([lat, lng], {
      radius: coverage,
      color: isActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)',
      fillColor: isActive ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
      fillOpacity: 1, weight: 1
    });

    cameraLayerGroup.addLayer(marker);
    cameraLayerGroup.addLayer(circle);
  });

  if (!layerState.cameras) map.removeLayer(cameraLayerGroup);
}

function createCameraPopup(cam) {
  const isActive = String(cam.status || '').toLowerCase() === 'active';
  const statusColor = isActive ? '#22c55e' : '#eab308';
  const safeName = escapeHtml(cam.name || 'CCTV Camera');
  const safeResolution = escapeHtml(cam.resolution || 'Unknown');
  const safeCoverage = Math.max(50, Math.round(toFiniteNumber(cam.coverage, 120)));
  const sourceTag = cam.source === 'openstreetmap'
    ? '<div style="font-size:10px;color:#64748b;margin-top:4px;">📡 Verified via OpenStreetMap</div>'
    : '<div style="font-size:10px;color:#eab308;margin-top:4px;">⚠ Estimated</div>';
  return `
    <div>
      <div class="popup-title">${safeName}</div>
      <span class="popup-type camera">${isActive ? 'ACTIVE' : 'MAINTENANCE'}</span>
      <div class="popup-row"><span class="label">📐 Range</span> ${safeCoverage}m radius</div>
      <div class="popup-row"><span class="label">🎥 Quality</span> ${safeResolution}</div>
      <div class="popup-row"><span class="label">⚡ Status</span> <span style="color: ${statusColor}">${isActive ? '● Online' : '● Maintenance'}</span></div>
      ${sourceTag}
    </div>
  `;
}

// ── Property Markers (Broker API) ─────────────────────────────
function updatePropertyMarkers(properties) {
  propertiesLayerGroup.clearLayers();
  
  properties.forEach(prop => {
    const lat = toFiniteNumber(prop.lat, NaN);
    const lng = toFiniteNumber(prop.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const icon = L.divIcon({
      html: `<div class="custom-marker marker-property" role="img" aria-label="Property">🏠</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([lat, lng], { icon })
      .bindPopup(createPropertyPopup({ ...prop, lat, lng }));

    marker.on('click', () => {
      onMapClick({ latlng: { lat, lng } });
    });

    propertiesLayerGroup.addLayer(marker);
  });

  if (!layerState.properties) map.removeLayer(propertiesLayerGroup);
}

function createPropertyPopup(prop) {
  const safeImage = sanitizeUrl(prop.image);
  const safeTitle = escapeHtml(prop.title || 'Property Listing');
  const listingType = prop.type === 'For Sale' ? 'For Sale' : 'For Rent';
  const safePrice = escapeHtml(prop.price || 'N/A');
  const beds = Math.max(0, Math.round(toFiniteNumber(prop.beds, 0)));
  const baths = Math.max(0, Math.round(toFiniteNumber(prop.baths, 0)));
  const sqft = Math.max(0, Math.round(toFiniteNumber(prop.sqft, 0)));

  return `
    <div style="min-width: 200px;">
      <img src="${safeImage}" alt="Property" referrerpolicy="no-referrer" style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px 8px 0 0; margin: -14px -14px 10px -14px; width: calc(100% + 28px); max-width: none;">
      <div class="popup-title">${safeTitle}</div>
      <span class="popup-type ${listingType === 'For Sale' ? 'police' : 'hospital'}">${listingType}</span>
      <div style="font-size: 16px; font-weight: bold; color: var(--accent-light); margin: 6px 0;">${safePrice}</div>
      <div class="popup-row">🛏️ ${beds} Beds | 🛁 ${baths} Baths</div>
      <div class="popup-row">📐 ${sqft} sqft</div>
      <div style="font-size:10px;color:#64748b;margin-top:6px;">Broker API Data (Simulated)</div>
    </div>
  `;
}

// ── Map Click Handler ─────────────────────────────────────────
async function onMapClick(e) {
  const { lat, lng } = e.latlng;

  // Remove previous selected marker
  if (selectedMarker) map.removeLayer(selectedMarker);

  // Add selected location marker
  const icon = L.divIcon({
    html: '<div class="custom-marker marker-selected" role="img" aria-label="Selected location"></div>',
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  selectedMarker = L.marker([lat, lng], { icon }).addTo(map);

  // Show loading sidebar
  openSidebar();
  showSidebarLoading();

  try {
    // Fetch real data for this location
    const [services, cameras, properties, areaInfo] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      fetchNearbyProperties(lat, lng, 2000),
      reverseGeocode(lat, lng)
    ]);

    // Check for API errors
    hasApiErrors = services.error || cameras.error || areaInfo.error;

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;

    // Update markers on map
    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);
    updatePropertyMarkers(lastFetchedProperties);

    // Calculate safety score
    const scoreData = calculateSafetyScore(currentHour, services, lastFetchedCameras, areaInfo);
    const score = scoreData.score;
    const factors = scoreData.factors;
    const level = getSafetyLevel(score);
    const { risks, features } = generateRiskFactors(currentHour, services, lastFetchedCameras, areaInfo);

    updateSidebar(score, level, areaInfo, services, lastFetchedCameras, risks, features, lat, lng, factors);
  } catch (err) {
    console.error('Error fetching location data:', err);
    showNotification('❌ Failed to analyze location. Please try again.', 'error', 5000);
    closeSidebar();
  }
}

function showSidebarLoading() {
  document.getElementById('sidebarContent').innerHTML = `
    <div style="text-align:center; padding: 60px 20px;">
      <div class="loading-spinner" style="margin: 0 auto 16px;"></div>
      <p style="color: var(--text-muted); font-size: 14px;">Scanning area...</p>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">Fetching real nearby services</p>
    </div>
  `;
}

function showEmergencyNumbers() {
  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const lines = [
    'Emergency Numbers',
    '',
    `🚨 Unified: ${nums.unified || 'N/A'}`,
    `🚔 Police: ${nums.police || 'N/A'}`,
    `🚑 Ambulance: ${nums.ambulance || 'N/A'}`,
    `🚒 Fire: ${nums.fire || 'N/A'}`
  ];

  if (nums.women) lines.push(`👩 Women: ${nums.women}`);
  if (nums.child) lines.push(`🧒 Child: ${nums.child}`);

  alert(lines.join('\n'));
}

// ── Sidebar ───────────────────────────────────────────────────
function updateSidebar(score, level, areaInfo, services, cameras, risks, features, lat, lng, factors) {
  const safeServices = services || {};
  const safeLevelClass = ['very-safe', 'moderate', 'caution', 'danger'].includes(level.class)
    ? level.class
    : 'moderate';
  const scoreColor = safeLevelClass === 'very-safe' ? '#22c55e' :
                     safeLevelClass === 'moderate' ? '#eab308' :
                     safeLevelClass === 'caution' ? '#f97316' : '#ef4444';
  const safeScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(score, 0))));

  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
  const policeServices = Array.isArray(safeServices.police) ? safeServices.police : [];
  const hospitalServices = Array.isArray(safeServices.hospital) ? safeServices.hospital : [];
  const fireServices = Array.isArray(safeServices.fire) ? safeServices.fire : [];
  const activeCams = cameraArray.filter(c => String(c.status || '').toLowerCase() === 'active');

  const safeLat = toFiniteNumber(lat, NaN);
  const safeLng = toFiniteNumber(lng, NaN);
  const favLat = Number.isFinite(safeLat) ? safeLat : 0;
  const favLng = Number.isFinite(safeLng) ? safeLng : 0;

  const isFavorite = favoriteLocations.some(fav =>
    Math.abs(fav.lat - favLat) < 0.0001 && Math.abs(fav.lng - favLng) < 0.0001
  );

  const safeAreaName = escapeHtml(areaInfo.name || 'Unknown Area');
  const safeArea = escapeHtml(areaInfo.area || '');
  const safeFullAddress = escapeHtml(areaInfo.fullAddress || `${favLat.toFixed(5)}, ${favLng.toFixed(5)}`);
  const safeTime = escapeHtml(formatTime(currentHour));
  const safeLevelLabel = escapeHtml(level.label || 'Unknown');
  const safeLevelIcon = escapeHtml(level.icon || 'ℹ️');

  const scoreFactorsHtml = (Array.isArray(factors) ? factors : [])
    .map(f => `<div class="factor-item">${escapeHtml(f)}</div>`)
    .join('');

  const riskTagsHtml = (Array.isArray(risks) ? risks : [])
    .map(r => `<span class="risk-tag negative">⚠ ${escapeHtml(r)}</span>`)
    .join('');

  const featureTagsHtml = (Array.isArray(features) ? features : [])
    .map(s => `<span class="risk-tag positive">✓ ${escapeHtml(s)}</span>`)
    .join('');

  const cameraRowsHtml = cameraArray.slice(0, 5).map(cam => {
    const camLat = toFiniteNumber(cam.lat, NaN);
    const camLng = toFiniteNumber(cam.lng, NaN);
    if (!Number.isFinite(camLat) || !Number.isFinite(camLng)) return '';

    const safeCamName = escapeHtml(cam.name || 'CCTV Camera');
    const safeResolution = escapeHtml(cam.resolution || 'Unknown');
    const statusActive = String(cam.status || '').toLowerCase() === 'active';
    const statusTag = statusActive
      ? '<span style="color:#22c55e">● Online</span>'
      : '<span style="color:#eab308">● Maintenance</span>';
    const sourceTag = cam.source === 'openstreetmap' ? ' • 📡' : '';
    const safeDistance = formatDistance(Math.max(0, Math.round(toFiniteNumber(cam.distance, 0))));

    return `
      <div class="service-card" onclick="map.flyTo([${camLat.toFixed(6)}, ${camLng.toFixed(6)}], 17)" tabindex="0" role="button" aria-label="View camera location on map">
        <div class="service-icon" style="background: rgba(34,197,94,0.15); font-size: 18px;">📹</div>
        <div class="service-info">
          <div class="service-name">${safeCamName}</div>
          <div class="service-meta">${safeResolution} • ${statusTag}${sourceTag}</div>
        </div>
        <div class="service-distance">${safeDistance}</div>
      </div>
    `;
  }).join('');

  const buildServiceRows = (items, iconClass, icon) => {
    const safeItems = Array.isArray(items) ? items : [];
    return safeItems.slice(0, 5).map(item => {
      const itemLat = toFiniteNumber(item.lat, NaN);
      const itemLng = toFiniteNumber(item.lng, NaN);
      if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return '';

      const safeName = escapeHtml(item.name || 'Service');
      const safePhone = escapeHtml(item.phone || 'N/A');
      const sourceTag = item.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.';
      const safeDistance = formatDistance(Math.max(0, Math.round(toFiniteNumber(item.distance, 0))));

      return `
        <div class="service-card" onclick="map.flyTo([${itemLat.toFixed(6)}, ${itemLng.toFixed(6)}], 16)" tabindex="0" role="button" aria-label="View service location on map">
          <div class="service-icon ${iconClass}">${icon}</div>
          <div class="service-info">
            <div class="service-name">${safeName}</div>
            <div class="service-meta">📞 ${safePhone}${sourceTag}</div>
          </div>
          <div class="service-distance">${safeDistance}</div>
        </div>
      `;
    }).join('');
  };

  const policeRows = buildServiceRows(policeServices, 'police', '🚔');
  const hospitalRows = buildServiceRows(hospitalServices, 'hospital', '🏥');
  const fireRows = buildServiceRows(fireServices, 'fire', '🚒');

  const safeCountry = escapeHtml(nums.country || currentCountryCode);
  const safeUnified = escapeHtml(nums.unified || 'N/A');
  const safePolice = escapeHtml(nums.police || 'N/A');
  const safeAmbulance = escapeHtml(nums.ambulance || 'N/A');
  const safeFire = escapeHtml(nums.fire || 'N/A');
  const safeWomen = nums.women ? escapeHtml(nums.women) : '';
  const safeChild = nums.child ? escapeHtml(nums.child) : '';

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
        <div class="disclaimer-title">Safety Score Disclaimer</div>
        <div class="disclaimer-text">This score is an estimate based on available data and should not be the sole factor in safety decisions. Always use your judgment and local knowledge.</div>
      </div>
    </div>

    <div class="safety-score-card ${safeLevelClass}">
      <div class="score-circle" style="--score-pct: ${safeScore}; --score-color: ${scoreColor}">
        <div>
          <div class="score-number" style="color: ${scoreColor}">${safeScore}</div>
          <div class="score-label">/ 100</div>
        </div>
      </div>
      <div class="safety-label" style="color: ${scoreColor}">${safeLevelIcon} ${safeLevelLabel}</div>
      <div class="zone-name">${safeAreaName} • ${safeTime}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${safeArea}</div>

      <button class="favorite-btn ${isFavorite ? 'active' : ''}" onclick="toggleFavorite(${favLat.toFixed(6)}, ${favLng.toFixed(6)})">
        ${isFavorite ? '⭐ Saved' : '☆ Save Location'}
      </button>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📊</span> Score Breakdown</div>
      <div class="score-factors">${scoreFactorsHtml}</div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📍</span> Location</div>
      <div style="font-size: 12px; color: var(--text-secondary); padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-glass); line-height: 1.6;">
        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">${safeAreaName}</div>
        <div>${safeFullAddress}</div>
        <div style="color: var(--text-muted); margin-top: 4px; font-size: 11px;">${favLat.toFixed(5)}, ${favLng.toFixed(5)}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">📞</span> Emergency Numbers (${safeCountry})</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚨</div>
          <div class="service-info">
            <div class="service-name" style="color: #ef4444;">${safeUnified}</div>
            <div class="service-meta">Unified Emergency</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚔</div>
          <div class="service-info">
            <div class="service-name" style="color: var(--accent-light);">${safePolice}</div>
            <div class="service-meta">Police</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚑</div>
          <div class="service-info">
            <div class="service-name" style="color: #22c55e;">${safeAmbulance}</div>
            <div class="service-meta">Ambulance</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚒</div>
          <div class="service-info">
            <div class="service-name" style="color: #f97316;">${safeFire}</div>
            <div class="service-meta">Fire</div>
          </div>
        </div>
      </div>
      ${safeWomen ? `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <div class="service-card" style="cursor:default;">
            <div style="font-size:20px;">👩</div>
            <div class="service-info">
              <div class="service-name" style="color: #e879f9;">${safeWomen}</div>
              <div class="service-meta">Women Helpline</div>
            </div>
          </div>
          ${safeChild ? `
            <div class="service-card" style="cursor:default;">
              <div style="font-size:20px;">🧒</div>
              <div class="service-info">
                <div class="service-name" style="color: #fbbf24;">${safeChild}</div>
                <div class="service-meta">Child Helpline</div>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">⚠️</span> Risk Factors</div>
      <div class="risk-tags">${riskTagsHtml}</div>
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🛡️</span> Safety Features</div>
      <div class="risk-tags">${featureTagsHtml}</div>
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
      ${cameraRowsHtml}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚔</span> Nearest Police Stations</div>
      ${policeServices.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No police stations found within 3 km</p>' : ''}
      ${policeRows}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🏥</span> Nearest Hospitals</div>
      ${hospitalServices.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No hospitals found within 3 km</p>' : ''}
      ${hospitalRows}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚒</span> Nearest Fire Stations</div>
      ${fireServices.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No fire stations found within 3 km</p>' : ''}
      ${fireRows}
    </div>

    <button class="emergency-btn" onclick="showEmergencyNumbers()" aria-label="Show emergency contact numbers">
      🆘 Emergency Numbers
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
  currentHour = parseInt(value);
  updateTimeDisplay();
  
  const slider = document.getElementById('timeSlider');
  slider.setAttribute('aria-valuenow', currentHour);
  
  updateHeatmap();

  // If a location is selected, recalculate safety
  if (selectedMarker && lastFetchedServices && lastAreaInfo) {
    const pos = selectedMarker.getLatLng();
    const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
    const score = scoreData.score;
    const factors = scoreData.factors;
    const level = getSafetyLevel(score);
    const { risks, features } = generateRiskFactors(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
    updateSidebar(score, level, lastAreaInfo, lastFetchedServices, lastFetchedCameras, risks, features, pos.lat, pos.lng, factors);
  }
}

function updateTimeDisplay() {
  document.getElementById('timeDisplay').textContent = formatTime(currentHour);
}

// ── Favorite Locations ────────────────────────────────────────
function toggleFavorite(lat, lng, name = '') {
  const safeLat = toFiniteNumber(lat, NaN);
  const safeLng = toFiniteNumber(lng, NaN);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    showNotification('Invalid location data for favorites.', 'error', 2500);
    return;
  }

  const resolvedName = (typeof name === 'string' && name.trim())
    ? name.trim()
    : (lastAreaInfo && typeof lastAreaInfo.name === 'string' && lastAreaInfo.name.trim())
      ? lastAreaInfo.name.trim()
      : 'Saved Location';

  const index = favoriteLocations.findIndex(fav =>
    Math.abs(fav.lat - safeLat) < 0.0001 && Math.abs(fav.lng - safeLng) < 0.0001
  );
  
  if (index > -1) {
    favoriteLocations.splice(index, 1);
    showNotification('📍 Location removed from favorites', 'info', 2000);
  } else {
    favoriteLocations.push({ lat: safeLat, lng: safeLng, name: resolvedName, timestamp: Date.now() });
    showNotification('⭐ Location saved to favorites', 'success', 2000);
  }
  
  localStorage.setItem('safezoneFavorites', JSON.stringify(favoriteLocations));
  
  // Refresh sidebar to update button
  if (selectedMarker && lastFetchedServices && lastAreaInfo) {
    const pos = selectedMarker.getLatLng();
    const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
    const score = scoreData.score;
    const factors = scoreData.factors;
    const level = getSafetyLevel(score);
    const { risks, features } = generateRiskFactors(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
    updateSidebar(score, level, lastAreaInfo, lastFetchedServices, lastFetchedCameras, risks, features, pos.lat, pos.lng, factors);
  }
}

// ── SafeHome Finder ───────────────────────────────────────────
function findSafestHomes() {
  if (!lastFetchedProperties || lastFetchedProperties.length === 0) {
    showNotification('No properties found nearby. Please search a new area.', 'warning');
    return;
  }

  if (!lastFetchedServices || !lastAreaInfo) {
    showNotification('Location services are not ready yet. Please try again in a moment.', 'warning');
    return;
  }
  
  showStatus('Scoring properties for safety...');
  
  let bestProp = null;
  let bestScore = -1;
  const baseScore = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo).score;
  const cameraArray = Array.isArray(lastFetchedCameras) ? lastFetchedCameras : [];
  
  lastFetchedProperties.forEach(prop => {
    const propLat = toFiniteNumber(prop.lat, NaN);
    const propLng = toFiniteNumber(prop.lng, NaN);
    if (!Number.isFinite(propLat) || !Number.isFinite(propLng)) return;

    let propScore = baseScore;

    const policeDist = nearestDistance(lastFetchedServices.police, propLat, propLng);
    const hospitalDist = nearestDistance(lastFetchedServices.hospital, propLat, propLng);
    const fireDist = nearestDistance(lastFetchedServices.fire, propLat, propLng);
    const nearbyCameras = countNearbyActiveCameras(cameraArray, propLat, propLng, 350);

    if (policeDist < 300) propScore += 12;
    else if (policeDist < 800) propScore += 7;
    else if (policeDist < 1500) propScore += 3;
    else if (!Number.isFinite(policeDist) || policeDist > 2500) propScore -= 10;

    if (hospitalDist < 600) propScore += 8;
    else if (hospitalDist < 1200) propScore += 4;
    else if (!Number.isFinite(hospitalDist) || hospitalDist > 3000) propScore -= 5;

    if (fireDist < 1000) propScore += 4;
    else if (!Number.isFinite(fireDist) || fireDist > 3000) propScore -= 3;

    if (nearbyCameras >= 3) propScore += 8;
    else if (nearbyCameras >= 1) propScore += 3;
    else propScore -= 4;

    propScore = Math.max(0, Math.min(100, Math.round(propScore)));
    
    if (propScore > bestScore) {
      bestScore = propScore;
      bestProp = { ...prop, lat: propLat, lng: propLng };
    }
  });

  if (bestProp) {
    setTimeout(() => {
      showStatus('');
      showNotification(`🏆 Safest Home Found! Estimated Score: ${bestScore}/100`, 'success', 5000);
      map.flyTo([bestProp.lat, bestProp.lng], 17);
      
      // Simulate a click on the safest property
      setTimeout(() => {
        onMapClick({ latlng: { lat: bestProp.lat, lng: bestProp.lng } });
        // Find and open the popup for this marker visually if possible
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
  }

  btn.classList.toggle('active', layerState[type]);
  btn.setAttribute('aria-pressed', layerState[type]);
  
  const layerName = type.charAt(0).toUpperCase() + type.slice(1);
  showNotification(`${layerState[type] ? '✓' : '✗'} ${layerName} layer ${layerState[type] ? 'enabled' : 'disabled'}`, 'info', 1500);
}

// ── Search ────────────────────────────────────────────────────
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
    const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const response = typeof throttledFetch === 'function'
      ? await throttledFetch(searchUrl, { headers: { 'Accept-Language': 'en' } })
      : await fetch(searchUrl, { headers: { 'Accept-Language': 'en' } });

    if (!response.ok) {
      throw new Error(`Search API returned status ${response.status}`);
    }

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Invalid coordinates returned by geocoder');
      }

      map.flyTo([lat, lon], 15, { duration: 1.5 });
      showNotification(`📍 Found: ${data[0].display_name.split(',')[0]}`, 'success', 3000);

      // Trigger safety analysis at the new location
      setTimeout(() => {
        onMapClick({ latlng: { lat, lng: lon } });
      }, 1600);
    } else {
      showNotification('❌ Location not found. Try a different search term.', 'error', 3000);
    }
  } catch (err) {
    showNotification('❌ Search failed. Please try again in a moment.', 'error', 3000);
    console.error(err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') searchLocation();
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
    btn.innerHTML = '🛡️ Enable Edge AI';
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  
  // Ensure EdgeAI updates trigger map refresh if a marker is selected
  if (typeof EdgeAI !== 'undefined') {
    EdgeAI.subscribe((state) => {
      // Re-score dynamically if an area is currently selected
      if (selectedMarker && lastFetchedServices && lastAreaInfo) {
         const pos = selectedMarker.getLatLng();
         const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
         const level = getSafetyLevel(scoreData.score);
         const { risks, features } = generateRiskFactors(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo);
         updateSidebar(scoreData.score, level, lastAreaInfo, lastFetchedServices, lastFetchedCameras, risks, features, pos.lat, pos.lng, scoreData.factors);
      }
    });
  }
});
