// ============================================================
// SafeZone — Core Application Logic (API-Powered)
// ============================================================

let map, heatLayer, selectedMarker;
let emergencyLayerGroup, cameraLayerGroup;
let currentHour = new Date().getHours();
let layerState = { heatmap: true, cameras: true, emergency: true };
let currentMapCenter = MAP_CENTER;
let lastFetchedServices = null;
let lastFetchedCameras = [];
let lastAreaInfo = null;
let isFetching = false;
let hasApiErrors = false;
let favoriteLocations = JSON.parse(localStorage.getItem('safezoneFavorites') || '[]');

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
    // Fetch services, cameras, and area info in parallel
    const [services, cameras, areaInfo] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      reverseGeocode(lat, lng)
    ]);

    // Check for API errors
    if (services.error || cameras.error || areaInfo.error) {
      hasApiErrors = true;
      showNotification('⚠️ Using estimated data - API temporarily unavailable', 'warning', 5000);
    }

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastAreaInfo = areaInfo;
    currentMapCenter = [lat, lng];

    // Update map markers
    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);
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
      <div class="popup-title">${service.name}</div>
      <span class="popup-type ${service.type}">${typeLabel}</span>
      ${service.address ? `<div class="popup-row"><span class="label">📍 Addr</span> ${service.address}</div>` : ''}
      <div class="popup-row"><span class="label">📞 Phone</span> <strong>${service.phone}</strong></div>
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
      fillOpacity: 1, weight: 1
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
      <div class="popup-title">${cam.name}</div>
      <span class="popup-type camera">${cam.status.toUpperCase()}</span>
      <div class="popup-row"><span class="label">📐 Range</span> ${cam.coverage}m radius</div>
      <div class="popup-row"><span class="label">🎥 Quality</span> ${cam.resolution}</div>
      <div class="popup-row"><span class="label">⚡ Status</span> <span style="color: ${statusColor}">${cam.status === 'active' ? '● Online' : '● Maintenance'}</span></div>
      ${sourceTag}
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
    const [services, cameras, areaInfo] = await Promise.all([
      fetchNearbyAmenities(lat, lng, 3000),
      fetchNearbyCameras(lat, lng, 2000),
      reverseGeocode(lat, lng)
    ]);

    // Check for API errors
    hasApiErrors = services.error || cameras.error || areaInfo.error;

    lastFetchedServices = services;
    lastFetchedCameras = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
    lastAreaInfo = areaInfo;

    // Update markers on map
    updateEmergencyMarkers(services);
    updateCameraMarkers(lastFetchedCameras);

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

// ── Sidebar ───────────────────────────────────────────────────
function updateSidebar(score, level, areaInfo, services, cameras, risks, features, lat, lng, factors) {
  const scoreColor = level.class === 'very-safe' ? '#22c55e' :
                     level.class === 'moderate' ? '#eab308' :
                     level.class === 'caution' ? '#f97316' : '#ef4444';

  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
  const activeCams = cameraArray.filter(c => c.status === 'active');
  
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

    <!-- Safety Score -->
    <div class="safety-score-card ${level.class}">
      <div class="score-circle" style="--score-pct: ${score}; --score-color: ${scoreColor}">
        <div>
          <div class="score-number" style="color: ${scoreColor}">${score}</div>
          <div class="score-label">/ 100</div>
        </div>
      </div>
      <div class="safety-label" style="color: ${scoreColor}">${level.icon} ${level.label}</div>
      <div class="zone-name">${areaInfo.name} • ${formatTime(currentHour)}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${areaInfo.area}</div>
      
      <button class="favorite-btn ${isFavorite ? 'active' : ''}" onclick="toggleFavorite(${lat}, ${lng}, '${areaInfo.name.replace(/'/g, "\\'")}')">
        ${isFavorite ? '⭐ Saved' : '☆ Save Location'}
      </button>
    </div>

    <!-- Score Breakdown -->
    <div class="section">
      <div class="section-title"><span class="icon">📊</span> Score Breakdown</div>
      <div class="score-factors">
        ${factors.map(f => `<div class="factor-item">${f}</div>`).join('')}
      </div>
    </div>

    <!-- Location -->
    <div class="section">
      <div class="section-title"><span class="icon">📍</span> Location</div>
      <div style="font-size: 12px; color: var(--text-secondary); padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-glass); line-height: 1.6;">
        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">${areaInfo.name}</div>
        <div>${areaInfo.fullAddress}</div>
        <div style="color: var(--text-muted); margin-top: 4px; font-size: 11px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      </div>
    </div>

    <!-- Emergency Numbers -->
    <div class="section">
      <div class="section-title"><span class="icon">📞</span> Emergency Numbers (${nums.country || currentCountryCode})</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚨</div>
          <div class="service-info">
            <div class="service-name" style="color: #ef4444;">${nums.unified}</div>
            <div class="service-meta">Unified Emergency</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚔</div>
          <div class="service-info">
            <div class="service-name" style="color: var(--accent-light);">${nums.police}</div>
            <div class="service-meta">Police</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚑</div>
          <div class="service-info">
            <div class="service-name" style="color: #22c55e;">${nums.ambulance}</div>
            <div class="service-meta">Ambulance</div>
          </div>
        </div>
        <div class="service-card" style="cursor:default;">
          <div style="font-size:20px;">🚒</div>
          <div class="service-info">
            <div class="service-name" style="color: #f97316;">${nums.fire}</div>
            <div class="service-meta">Fire</div>
          </div>
        </div>
      </div>
      ${nums.women ? `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <div class="service-card" style="cursor:default;">
            <div style="font-size:20px;">👩</div>
            <div class="service-info">
              <div class="service-name" style="color: #e879f9;">${nums.women}</div>
              <div class="service-meta">Women Helpline</div>
            </div>
          </div>
          <div class="service-card" style="cursor:default;">
            <div style="font-size:20px;">🧒</div>
            <div class="service-info">
              <div class="service-name" style="color: #fbbf24;">${nums.child}</div>
              <div class="service-meta">Child Helpline</div>
            </div>
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Risk Factors -->
    <div class="section">
      <div class="section-title"><span class="icon">⚠️</span> Risk Factors</div>
      <div class="risk-tags">
        ${risks.map(r => `<span class="risk-tag negative">⚠ ${r}</span>`).join('')}
      </div>
    </div>

    <!-- Safety Features -->
    <div class="section">
      <div class="section-title"><span class="icon">🛡️</span> Safety Features</div>
      <div class="risk-tags">
        ${features.map(s => `<span class="risk-tag positive">✓ ${s}</span>`).join('')}
      </div>
    </div>

    <!-- CCTV Cameras -->
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
        <div class="service-card" onclick="map.flyTo([${c.lat}, ${c.lng}], 17)" tabindex="0" role="button" aria-label="View ${c.name} on map">
          <div class="service-icon" style="background: rgba(34,197,94,0.15); font-size: 18px;">📹</div>
          <div class="service-info">
            <div class="service-name">${c.name}</div>
            <div class="service-meta">${c.resolution} • ${c.status === 'active' ? '<span style="color:#22c55e">● Online</span>' : '<span style="color:#eab308">● Maintenance</span>'}${c.source === 'openstreetmap' ? ' • 📡' : ''}</div>
          </div>
          <div class="service-distance">${formatDistance(c.distance)}</div>
        </div>
      `).join('')}
    </div>

    <!-- Police -->
    <div class="section">
      <div class="section-title"><span class="icon">🚔</span> Nearest Police Stations</div>
      ${services.police.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No police stations found within 3 km</p>' : ''}
      ${services.police.slice(0, 5).map(p => `
        <div class="service-card" onclick="map.flyTo([${p.lat}, ${p.lng}], 16)" tabindex="0" role="button" aria-label="View ${p.name} on map">
          <div class="service-icon police">🚔</div>
          <div class="service-info">
            <div class="service-name">${p.name}</div>
            <div class="service-meta">📞 ${p.phone}${p.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
          </div>
          <div class="service-distance">${formatDistance(p.distance)}</div>
        </div>
      `).join('')}
    </div>

    <!-- Hospitals -->
    <div class="section">
      <div class="section-title"><span class="icon">🏥</span> Nearest Hospitals</div>
      ${services.hospital.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No hospitals found within 3 km</p>' : ''}
      ${services.hospital.slice(0, 5).map(h => `
        <div class="service-card" onclick="map.flyTo([${h.lat}, ${h.lng}], 16)" tabindex="0" role="button" aria-label="View ${h.name} on map">
          <div class="service-icon hospital">🏥</div>
          <div class="service-info">
            <div class="service-name">${h.name}</div>
            <div class="service-meta">📞 ${h.phone}${h.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
          </div>
          <div class="service-distance">${formatDistance(h.distance)}</div>
        </div>
      `).join('')}
    </div>

    <!-- Fire -->
    <div class="section">
      <div class="section-title"><span class="icon">🚒</span> Nearest Fire Stations</div>
      ${services.fire.length === 0 ? '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No fire stations found within 3 km</p>' : ''}
      ${services.fire.slice(0, 5).map(f => `
        <div class="service-card" onclick="map.flyTo([${f.lat}, ${f.lng}], 16)" tabindex="0" role="button" aria-label="View ${f.name} on map">
          <div class="service-icon fire">🚒</div>
          <div class="service-info">
            <div class="service-name">${f.name}</div>
            <div class="service-meta">📞 ${f.phone}${f.source === 'openstreetmap' ? ' • 📡 Verified' : ' • ⚠ Est.'}</div>
          </div>
          <div class="service-distance">${formatDistance(f.distance)}</div>
        </div>
      `).join('')}
    </div>

    <!-- Emergency Button -->
    <button class="emergency-btn" onclick="alert('Emergency Numbers:\\n\\n🚨 Unified: ${nums.unified}\\n🚔 Police: ${nums.police}\\n🚑 Ambulance: ${nums.ambulance}\\n🚒 Fire: ${nums.fire}${nums.women ? '\\n👩 Women: ' + nums.women : ''}${nums.child ? '\\n🧒 Child: ' + nums.child : ''}')" aria-label="Show emergency contact numbers">
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
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await response.json();

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

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
    showNotification('❌ Search failed. Please check your internet connection.', 'error', 3000);
    console.error(err);
  }

  btn.textContent = originalText;
  btn.disabled = false;
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
