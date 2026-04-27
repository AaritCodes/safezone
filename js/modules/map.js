import { state } from './state.js';
import { formatTime, formatDistance, escapeHtml, escapeJsString, formatIncidentSourceLabel, safeMapCoordinate, withTimeoutFallback } from './utils.js';
import { calculateSafetyScore } from './scoring.js';
import { 
  refreshSelectedSidebar, 
  loadAreaData, 
  showSidebarLoading, 
  openSidebar, 
  updateTimeDisplay, 
  getCongestionClass 
} from './ui.js';
import { 
  fetchBackendSafetyAssessment, 
  fetchNearbyAmenities, 
  fetchNearbyCameras, 
  fetchNearbyProperties, 
  reverseGeocode, 
  fetchPublicSafetyRisk,
  getDistance,
  getHeatmapData
} from './api.js';
import { enrichRiskDataWithBackendAssessment } from './ui.js';
import { showStatus, showNotification } from './notifications.js';
import { MAP_CENTER, MAP_ZOOM, SCAN_CALL_TIMEOUT_MS, SCAN_SOFT_DEADLINE_MS } from './config.js';

// ── Initialize Map ────────────────────────────────────────────
export function initMap() {
  state.map = L.map('map', {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: false,
    attributionControl: false
  });
  L.control.zoom({
    position: 'bottomleft'
  }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(state.map);
  L.control.attribution({
    position: 'bottomleft',
    prefix: false
  }).addAttribution('© OpenStreetMap contributors | SafeZone').addTo(state.map);
  state.emergencyLayerGroup = L.layerGroup().addTo(state.map);
  state.cameraLayerGroup = L.layerGroup().addTo(state.map);
  state.propertiesLayerGroup = L.layerGroup().addTo(state.map);
  state.riskLayerGroup = L.layerGroup().addTo(state.map);
  initHeatmap();
  state.map.on('click', onMapClick);
  const slider = document.getElementById('timeSlider');
  slider.value = state.currentHour;
  slider.setAttribute('aria-label', 'Time of day slider');
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', '23');
  slider.setAttribute('aria-valuenow', state.currentHour);
  updateTimeDisplay();
  const hideLoading = () => {
    setTimeout(() => {
      document.getElementById('loadingOverlay').classList.add('hidden');
    }, 500);
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
      const userLat = position.coords.latitude;
      const userLng = position.coords.longitude;
      state.map.setView([userLat, userLng], MAP_ZOOM);
      loadAreaData(userLat, userLng);
      hideLoading();
    }, error => {
      console.warn('Geolocation failed or denied. Falling back to default.', error);
      loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);
      hideLoading();
    }, {
      timeout: 10000,
      maximumAge: 0
    });
  } else {
    loadAreaData(MAP_CENTER[0], MAP_CENTER[1]);
    hideLoading();
  }
}

// ── Heatmap Layer ─────────────────────────────────────────────
export function initHeatmap() {
  const data = getHeatmapData(state.currentHour, state.currentMapCenter);
  state.heatLayer = L.heatLayer(data, {
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
  }).addTo(state.map);
}
export function updateHeatmap() {
  if (state.heatLayer) state.map.removeLayer(state.heatLayer);
  const data = getHeatmapData(state.currentHour, state.currentMapCenter);
  state.heatLayer = L.heatLayer(data, {
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
  if (state.layerState.heatmap) { state.heatLayer.addTo(state.map); document.getElementById('heatmapBadge').style.display = 'block'; } else { document.getElementById('heatmapBadge').style.display = 'none'; }
}

// ── Emergency Service Markers ─────────────────────────────────
export function updateEmergencyMarkers(services) {
  state.emergencyLayerGroup.clearLayers();
  const allServices = [...services.police, ...services.hospital, ...services.fire];
  allServices.forEach(service => {
    const iconClass = service.type === 'police' ? 'marker-police' : service.type === 'hospital' ? 'marker-hospital' : 'marker-fire';
    const emoji = service.type === 'police' ? '🚔' : service.type === 'hospital' ? '🏥' : '🚒';
    const icon = L.divIcon({
      html: `<div class="custom-marker ${iconClass}">${emoji}</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const marker = L.marker([service.lat, service.lng], {
      icon
    }).bindPopup(createServicePopup(service));
    state.emergencyLayerGroup.addLayer(marker);
  });
  if (!state.layerState.emergency) state.map.removeLayer(state.emergencyLayerGroup);
}
export function createServicePopup(service) {
  const typeLabel = service.type.charAt(0).toUpperCase() + service.type.slice(1);
  const sourceTag = service.source === 'openstreetmap' ? '<div style="font-size:10px;color:#64748b;margin-top:6px;">📡 Verified via OpenStreetMap</div>' : service.source === 'google-places' ? '<div style="font-size:10px;color:#0ea5e9;margin-top:6px;">🗺 Verified via Google Places</div>' : '<div style="font-size:10px;color:#eab308;margin-top:6px;">⚠ Estimated location</div>';
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
export function updateCameraMarkers(cameras) {
  state.cameraLayerGroup.clearLayers();
  const cameraArray = Array.isArray(cameras) ? cameras : cameras.cameras || [];
  cameraArray.forEach(cam => {
    const icon = L.divIcon({
      html: `<div class="custom-marker marker-camera" style="opacity: ${cam.status === 'active' ? '1' : '0.5'}" role="img" aria-label="CCTV Camera">📹</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    const marker = L.marker([cam.lat, cam.lng], {
      icon
    }).bindPopup(createCameraPopup(cam));
    const circle = L.circle([cam.lat, cam.lng], {
      radius: cam.coverage,
      color: cam.status === 'active' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)',
      fillColor: cam.status === 'active' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
      fillOpacity: 1,
      weight: 1
    });
    state.cameraLayerGroup.addLayer(marker);
    state.cameraLayerGroup.addLayer(circle);
  });
  if (!state.layerState.cameras) state.map.removeLayer(state.cameraLayerGroup);
}
export function createCameraPopup(cam) {
  const statusColor = cam.status === 'active' ? '#22c55e' : '#eab308';
  const sourceTag = cam.source === 'openstreetmap' ? '<div style="font-size:10px;color:#64748b;margin-top:4px;">📡 Verified via OpenStreetMap</div>' : cam.source === 'google-places' ? '<div style="font-size:10px;color:#0ea5e9;margin-top:4px;">🗺 Google Places nearby result</div>' : '<div style="font-size:10px;color:#eab308;margin-top:4px;">⚠ Estimated</div>';
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
export function updatePropertyMarkers(properties) {
  state.propertiesLayerGroup.clearLayers();
  properties.forEach(prop => {
    const icon = L.divIcon({
      html: '<div class="custom-marker marker-property" role="img" aria-label="Property">🏠</div>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    const marker = L.marker([prop.lat, prop.lng], {
      icon
    }).bindPopup(createPropertyPopup(prop));
    marker.on('click', () => {
      onMapClick({
        latlng: {
          lat: prop.lat,
          lng: prop.lng
        }
      });
    });
    state.propertiesLayerGroup.addLayer(marker);
  });
  if (!state.layerState.properties) state.map.removeLayer(state.propertiesLayerGroup);
}
export function createPropertyPopup(prop) {
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
export function updateRiskMarkers(riskData) {
  state.riskLayerGroup.clearLayers();
  if (!riskData || !Array.isArray(riskData.hotspots)) return;
  riskData.hotspots.slice(0, 50).forEach(point => {
    const color = point.type === 'theft' ? '#ef4444' : point.type === 'violent' ? '#f97316' : point.type === 'accident' ? '#f59e0b' : '#eab308';
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
    state.riskLayerGroup.addLayer(marker);
  });
  if (!state.layerState.risk) state.map.removeLayer(state.riskLayerGroup);
}

// ── Map Click Handler ─────────────────────────────────────────
export async function onMapClick(e) {
  const {
    lat,
    lng
  } = e.latlng;
  const requestId = ++state.activeScanRequestId;
  if (state.selectedMarker) state.map.removeLayer(state.selectedMarker);
  const icon = L.divIcon({
    html: '<div class="custom-marker marker-selected" role="img" aria-label="Selected location"></div>',
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  state.selectedMarker = L.marker([lat, lng], {
    icon
  }).addTo(state.map);
  openSidebar();
  showSidebarLoading();
  let services = {
    police: [],
    hospital: [],
    fire: []
  };
  let cameras = [];
  let properties = [];
  let areaInfo = {
    name: 'Selected location',
    fullAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    area: '',
    type: 'unknown',
    category: 'unknown',
    countryCode: state.currentCountryCode || 'IN'
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
    const servicesP = withTimeoutFallback(fetchNearbyAmenities(lat, lng, 3000), SCAN_CALL_TIMEOUT_MS, () => ({
      police: [],
      hospital: [],
      fire: [],
      error: 'API_TIMEOUT'
    }), 'Amenities fetch').then(result => {
      services = result || services;
      if (services && services.error) scanHadErrors = true;
      if (requestId !== state.activeScanRequestId) return;
      updateEmergencyMarkers(services);
    }).catch(err => {
      console.warn('Amenities fetch failed during scan:', err);
      scanHadErrors = true;
    });
    const camerasP = withTimeoutFallback(fetchNearbyCameras(lat, lng, 2000), SCAN_CALL_TIMEOUT_MS, () => ({
      cameras: [],
      error: 'API_TIMEOUT'
    }), 'Camera fetch').then(result => {
      const cameraArray = Array.isArray(result) ? result : result && Array.isArray(result.cameras) ? result.cameras : [];
      cameras = cameraArray;
      if (result && result.error) scanHadErrors = true;
      if (requestId !== state.activeScanRequestId) return;
      updateCameraMarkers(cameras);
    }).catch(err => {
      console.warn('Camera fetch failed during scan:', err);
      scanHadErrors = true;
    });
    const propertiesP = withTimeoutFallback(fetchNearbyProperties(lat, lng, 2000), SCAN_CALL_TIMEOUT_MS, () => [], 'Property fetch').then(result => {
      properties = Array.isArray(result) ? result : [];
      if (requestId !== state.activeScanRequestId) return;
      updatePropertyMarkers(properties);
    }).catch(err => {
      console.warn('Property fetch failed during scan:', err);
      scanHadErrors = true;
    });
    const geocodeP = withTimeoutFallback(reverseGeocode(lat, lng), SCAN_CALL_TIMEOUT_MS, () => areaInfo, 'Reverse geocode').then(result => {
      if (result && typeof result === 'object') {
        areaInfo = {
          ...areaInfo,
          ...result
        };
      }
      if (result && result.error) scanHadErrors = true;
    }).catch(err => {
      console.warn('Reverse geocode failed during scan:', err);
      scanHadErrors = true;
    });
    const riskP = withTimeoutFallback(fetchPublicSafetyRisk(lat, lng), SCAN_CALL_TIMEOUT_MS, () => ({
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
    }), 'Public safety risk fetch').then(result => {
      if (result && typeof result === 'object') {
        riskData = result;
      }
      if (riskData && (riskData.error || riskData.partialError || riskData.criticalError)) {
        scanHadErrors = true;
      }
      if (requestId !== state.activeScanRequestId) return;
      updateRiskMarkers(riskData);
    }).catch(err => {
      console.warn('Public safety risk fetch failed during scan:', err);
      scanHadErrors = true;
    });
    const backendAssessmentP = Promise.allSettled([servicesP, camerasP, geocodeP, riskP]).then(() => enrichRiskDataWithBackendAssessment(lat, lng, state.currentHour, services, cameras, areaInfo, riskData)).then(enriched => {
      if (!enriched || typeof enriched !== 'object') return;
      riskData = enriched;
      if (requestId !== state.activeScanRequestId) return;
      updateRiskMarkers(riskData);
    }).catch(err => {
      console.warn('Backend assessment failed during scan:', err);
    });
    const allFetches = [servicesP, camerasP, propertiesP, geocodeP, riskP];
    const completedBeforeDeadline = await Promise.race([Promise.allSettled(allFetches).then(() => true), new Promise(resolve => setTimeout(() => resolve(false), SCAN_SOFT_DEADLINE_MS))]);
    if (!completedBeforeDeadline) {
      scanHadErrors = true;
    }
    if (requestId !== state.activeScanRequestId) return;
    state.hasApiErrors = scanHadErrors;
    state.lastFetchedServices = services;
    state.lastFetchedCameras = cameras;
    state.lastFetchedProperties = properties;
    state.lastAreaInfo = areaInfo;
    state.lastRiskData = riskData;
    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    refreshSelectedSidebar();
    if (scanHadErrors) {
      showNotification('⚠️ Some feeds are slow or unavailable. Showing best available estimates.', 'warning', 5000);
    }
    Promise.allSettled([...allFetches, backendAssessmentP]).then(() => {
      if (requestId !== state.activeScanRequestId) return;
      state.hasApiErrors = scanHadErrors;
      state.lastFetchedServices = services;
      state.lastFetchedCameras = cameras;
      state.lastFetchedProperties = properties;
      state.lastAreaInfo = areaInfo;
      state.lastRiskData = riskData;
      updateEmergencyMarkers(services);
      updateCameraMarkers(cameras);
      updatePropertyMarkers(properties);
      updateRiskMarkers(riskData);
      refreshSelectedSidebar();
    });
  } catch (err) {
    if (requestId !== state.activeScanRequestId) return;
    console.error('Error fetching location data:', err);
    state.hasApiErrors = true;
    state.lastFetchedServices = services;
    state.lastFetchedCameras = cameras;
    state.lastFetchedProperties = properties;
    state.lastAreaInfo = areaInfo;
    state.lastRiskData = riskData;
    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    refreshSelectedSidebar();
    showNotification('⚠️ Scan timed out. Showing limited data for this area.', 'warning', 5000);
  }
}
export function clearRouteDrawing() {
  state.routeAlternativeLayers.forEach(layer => {
    if (layer && state.map && state.map.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });
  state.routeAlternativeLayers = [];
  state.routeLayer = null;
}
export function drawRoute(routeData, options = {}) {
  clearRouteDrawing();
  const alternatives = Array.isArray(routeData && routeData.alternatives) && routeData.alternatives.length > 0 ? routeData.alternatives : [{
    id: 'route_primary',
    path: routeData && routeData.path ? routeData.path : [],
    congestion: routeData ? routeData.congestion : null
  }];
  const selectedRouteId = routeData && routeData.selectedRouteId ? routeData.selectedRouteId : alternatives[0] && alternatives[0].id ? alternatives[0].id : 'route_primary';
  alternatives.forEach(candidate => {
    if (!Array.isArray(candidate.path) || candidate.path.length < 2) return;
    const isActive = candidate.id === selectedRouteId;
    const congestionLevel = getCongestionClass(candidate.congestion && candidate.congestion.level);
    const inactiveColor = congestionLevel === 'severe' ? '#ef4444' : congestionLevel === 'high' ? '#f97316' : congestionLevel === 'low' ? '#22c55e' : '#eab308';
    const polyline = L.polyline(candidate.path, {
      color: isActive ? '#38bdf8' : inactiveColor,
      weight: isActive ? 6 : 4,
      opacity: isActive ? 0.95 : 0.46,
      lineJoin: 'round',
      dashArray: isActive ? null : '8 10',
      interactive: false
    }).addTo(state.map);
    state.routeAlternativeLayers.push(polyline);
    if (isActive) state.routeLayer = polyline;
  });
  const focusLayer = state.routeLayer || state.routeAlternativeLayers[0];
  if (focusLayer && !options.preserveViewport) {
    state.map.fitBounds(focusLayer.getBounds(), {
      padding: [60, 60]
    });
  }
}