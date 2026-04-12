// ============================================================
// SafeZone — Core Application Logic (API-Powered)
// ============================================================

let map, heatLayer, selectedMarker, routeLayer;
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

let favoriteLocations = JSON.parse(localStorage.getItem('safezoneFavorites') || '[]');
let emergencyContacts = JSON.parse(localStorage.getItem('safezoneEmergencyContacts') || '[]');

let activeRoute = null;
let routeDestination = null;
let routeStepIndex = 0;
let navigationWatchId = null;

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
  return String(phone || '').replace(/[^\d+]/g, '');
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

  loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);

  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 1500);
}

// ── Load Area Data from APIs ──────────────────────────────────
async function loadAreaData(lat, lng) {
  if (isFetching) return;
  isFetching = true;
  hasApiErrors = false;

  showStatus('Scanning area...');

  try {
    const [services, cameras, properties, areaInfo, riskData] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      fetchNearbyProperties(lat, lng, 2000),
      reverseGeocode(lat, lng),
      fetchPublicSafetyRisk(lat, lng)
    ]);

    if (services.error || cameras.error || areaInfo.error || riskData.error) {
      hasApiErrors = true;
      showNotification('⚠️ Some feeds are unavailable. Showing best available estimates.', 'warning', 5000);
    }

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;
    currentMapCenter = [lat, lng];

    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);
    updatePropertyMarkers(lastFetchedProperties);
    updateRiskMarkers(riskData);
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

// ── Map Click Handler ─────────────────────────────────────────
async function onMapClick(e) {
  const { lat, lng } = e.latlng;

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

  try {
    const [services, cameras, properties, areaInfo, riskData] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      fetchNearbyProperties(lat, lng, 2000),
      reverseGeocode(lat, lng),
      fetchPublicSafetyRisk(lat, lng)
    ]);

    hasApiErrors = Boolean(services.error || cameras.error || areaInfo.error || riskData.error);

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastFetchedProperties = properties;
    lastAreaInfo = areaInfo;
    lastRiskData = riskData;

    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);
    updatePropertyMarkers(lastFetchedProperties);
    updateRiskMarkers(riskData);

    refreshSelectedSidebar();
  } catch (err) {
    console.error('Error fetching location data:', err);
    showNotification('❌ Failed to analyze location. Please try again.', 'error', 5000);
    closeSidebar();
  }
}

function refreshSelectedSidebar() {
  if (!selectedMarker || !lastFetchedServices || !lastAreaInfo) return;

  const pos = selectedMarker.getLatLng();
  const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo, lastRiskData);
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

// ── Sidebar ───────────────────────────────────────────────────
function updateSidebar(score, level, areaInfo, services, cameras, risks, features, lat, lng, factors, riskData) {
  const scoreColor = level.class === 'very-safe' ? '#22c55e' :
    level.class === 'moderate' ? '#eab308' :
      level.class === 'caution' ? '#f97316' : '#ef4444';

  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
  const activeCams = cameraArray.filter(c => c.status === 'active');
  const safeAreaName = escapeJsString(areaInfo.name || 'Selected location');

  const isFavorite = favoriteLocations.some(fav =>
    Math.abs(fav.lat - lat) < 0.0001 && Math.abs(fav.lng - lng) < 0.0001
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
        <div class="disclaimer-title">Safety Score Disclaimer</div>
        <div class="disclaimer-text">This score is an estimate based on available data and should not be the sole factor in safety decisions. Always use your judgment and local knowledge.</div>
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
      <div class="zone-name">${escapeHtml(areaInfo.name)} • ${formatTime(currentHour)}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(areaInfo.area || '')}</div>

      <button class="favorite-btn ${isFavorite ? 'active' : ''}" onclick="toggleFavorite(${lat}, ${lng}, '${safeAreaName}')">
        ${isFavorite ? '⭐ Saved' : '☆ Save Location'}
      </button>
      <button class="route-now-btn" onclick="startDirectionsTo(${lat}, ${lng}, '${safeAreaName}')">
        🧭 Directions Here
      </button>
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
          Confidence: ${escapeHtml(riskData.confidence || 'low')} • Crime source: ${escapeHtml((riskData.sources && riskData.sources.crime) || 'unavailable')} • Accident source: ${escapeHtml((riskData.sources && riskData.sources.accidents) || 'unavailable')}
        </div>
      </div>
    ` : ''}

    <div class="section">
      <div class="section-title"><span class="icon">📍</span> Location</div>
      <div style="font-size: 12px; color: var(--text-secondary); padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-glass); line-height: 1.6;">
        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">${escapeHtml(areaInfo.name)}</div>
        <div>${escapeHtml(areaInfo.fullAddress || '')}</div>
        <div style="color: var(--text-muted); margin-top: 4px; font-size: 11px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
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
        <div class="service-card" onclick="map.flyTo([${c.lat}, ${c.lng}], 17)" tabindex="0" role="button" aria-label="View ${escapeHtml(c.name)} on map">
          <div class="service-icon" style="background: rgba(34,197,94,0.15); font-size: 18px;">📹</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(c.name)}</div>
            <div class="service-meta">${escapeHtml(c.resolution)} • ${c.status === 'active' ? '<span style="color:#22c55e">● Online</span>' : '<span style="color:#eab308">● Maintenance</span>'}${c.source === 'openstreetmap' ? ' • 📡' : ''}</div>
          </div>
          <div class="service-distance">${formatDistance(c.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚔</span> Nearest Police Stations</div>
      ${services.police.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No police stations found within 3 km</p>' : ''}
      ${services.police.slice(0, 5).map(p => `
        <div class="service-card" onclick="map.flyTo([${p.lat}, ${p.lng}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(p.name)} on map">
          <div class="service-icon police">🚔</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(p.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(p.phone)}${p.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
          </div>
          <div class="service-distance">${formatDistance(p.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🏥</span> Nearest Hospitals</div>
      ${services.hospital.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No hospitals found within 3 km</p>' : ''}
      ${services.hospital.slice(0, 5).map(h => `
        <div class="service-card" onclick="map.flyTo([${h.lat}, ${h.lng}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(h.name)} on map">
          <div class="service-icon hospital">🏥</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(h.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(h.phone)}${h.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
          </div>
          <div class="service-distance">${formatDistance(h.distance)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-title"><span class="icon">🚒</span> Nearest Fire Stations</div>
      ${services.fire.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No fire stations found within 3 km</p>' : ''}
      ${services.fire.slice(0, 5).map(f => `
        <div class="service-card" onclick="map.flyTo([${f.lat}, ${f.lng}], 16)" tabindex="0" role="button" aria-label="View ${escapeHtml(f.name)} on map">
          <div class="service-icon fire">🚒</div>
          <div class="service-info">
            <div class="service-name">${escapeHtml(f.name)}</div>
            <div class="service-meta">📞 ${escapeHtml(f.phone)}${f.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
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
}

function updateTimeDisplay() {
  document.getElementById('timeDisplay').textContent = formatTime(currentHour);
}

// ── Favorite Locations ────────────────────────────────────────
function toggleFavorite(lat, lng, name) {
  const index = favoriteLocations.findIndex(fav =>
    Math.abs(fav.lat - lat) < 0.0001 && Math.abs(fav.lng - lng) < 0.0001
  );

  if (index > -1) {
    favoriteLocations.splice(index, 1);
    showNotification('📍 Location removed from favorites', 'info', 2000);
  } else {
    favoriteLocations.push({ lat, lng, name, timestamp: Date.now() });
    showNotification('⭐ Location saved to favorites', 'success', 2000);
  }

  localStorage.setItem('safezoneFavorites', JSON.stringify(favoriteLocations));
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
    const scoreData = calculateSafetyScore(currentHour, lastFetchedServices, lastFetchedCameras, lastAreaInfo, lastRiskData);
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
async function geocodeQuery(query) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
    { headers: { 'Accept-Language': 'en' } }
  );
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    label: data[0].display_name.split(',')[0],
    fullLabel: data[0].display_name
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
      showNotification('❌ Location not found. Try a different search term.', 'error', 3000);
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
}

function closeDirectionsPanel() {
  document.getElementById('directionsPanel').classList.remove('open');
  stopVoiceNavigation();
}

function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: currentMapCenter[0], lng: currentMapCenter[1], source: 'map-center' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device' });
      },
      () => {
        showNotification('Location permission denied. Using current map center as start point.', 'warning', 4000);
        resolve({ lat: currentMapCenter[0], lng: currentMapCenter[1], source: 'map-center' });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000
      }
    );
  });
}

function renderDirectionsPanel(route, destinationLabel) {
  const content = document.getElementById('directionsContent');
  if (!content) return;

  const stepsMarkup = route.steps.slice(0, 20).map((step, idx) => `
    <div class="direction-step" id="route-step-${idx}">
      <div class="direction-step-index">${idx + 1}</div>
      <div class="direction-step-text">
        <div class="direction-instruction">${escapeHtml(step.instruction)}</div>
        <div class="direction-meta">${formatDistance(step.distance)} • ${formatDuration(step.duration)}</div>
      </div>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="directions-summary">
      <div class="directions-destination">📍 ${escapeHtml(destinationLabel)}</div>
      <div class="directions-stats">${formatDistance(route.distance)} • ${formatDuration(route.duration)} • ${route.steps.length} steps</div>
      <div class="directions-actions">
        <button class="search-btn" onclick="speakRouteOverview()">🔊 Speak Overview</button>
        <button class="search-btn directions-btn" onclick="startVoiceNavigation()">🎙 Start Voice Guidance</button>
        <button class="search-btn" onclick="stopVoiceNavigation()">⏹ Stop</button>
      </div>
    </div>
    <div class="directions-steps">${stepsMarkup}</div>
  `;
}

function drawRoute(routePath) {
  if (routeLayer) map.removeLayer(routeLayer);

  routeLayer = L.polyline(routePath, {
    color: '#38bdf8',
    weight: 5,
    opacity: 0.9,
    lineJoin: 'round'
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
}

async function startDirectionsTo(lat, lng, label = 'Destination') {
  showStatus('Calculating route...');

  try {
    const origin = await getCurrentLocation();
    const route = await fetchRouteDirections(origin.lat, origin.lng, lat, lng, 'driving');

    activeRoute = route;
    routeDestination = { lat, lng, label };
    routeStepIndex = 0;

    drawRoute(route.path);
    renderDirectionsPanel(route, label);
    openDirectionsPanel();

    if (route.error) {
      showNotification('⚠️ Live routing unavailable. Showing direct fallback line.', 'warning', 4000);
    } else {
      showNotification(`🧭 Route ready to ${label}`, 'success', 2500);
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
      showNotification('❌ Destination not found.', 'error', 2500);
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

  const summary = `Route to ${routeDestination.label}. Total distance ${formatDistance(activeRoute.distance)}. Estimated time ${formatDuration(activeRoute.duration)}.`;
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
  localStorage.setItem('safezoneEmergencyContacts', JSON.stringify(emergencyContacts));
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
        <button class="contact-action call" onclick="callEmergencyContact('${contact.id}')">Call</button>
        <button class="contact-action remove" onclick="removeEmergencyContact('${contact.id}')">Remove</button>
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
  const name = nameInput.value.trim();
  const phone = sanitizePhoneNumber(phoneInput.value.trim());

  if (!name || !phone || phone.length < 6) {
    showNotification('Enter a valid contact name and phone number.', 'warning', 2500);
    return;
  }

  if (emergencyContacts.length >= 5) {
    showNotification('You can store up to 5 emergency contacts.', 'warning', 3000);
    return;
  }

  emergencyContacts.push({
    id: Date.now().toString(),
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

  window.location.href = `tel:${sanitizePhoneNumber(contact.phone)}`;
}

function triggerSOSCall() {
  if (!emergencyContacts.length) {
    showNotification('Add at least one emergency contact first.', 'warning', 2500);
    openEmergencyContacts();
    return;
  }

  const primary = emergencyContacts[0];
  showNotification(`Calling ${primary.name}...`, 'warning', 2000);
  window.location.href = `tel:${sanitizePhoneNumber(primary.phone)}`;
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
  renderEmergencyContacts();

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
    });
  }
});
