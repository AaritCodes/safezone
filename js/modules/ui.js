import { state } from './state.js';
import { calculateSafetyScore, getSafetyLevel, generateRiskFactors } from './scoring.js';
import { formatTime, formatDistance, escapeHtml, escapeJsString, stripHtmlTags, normalizeDisplayText, sanitizePhoneNumber, formatDuration, isValidPhoneNumber, safeMapCoordinate, withTimeoutFallback, formatIncidentSourceLabel } from './utils.js';
import { showStatus, showNotification } from './notifications.js';
import { getBackendApiKey, getGoogleApiKey, buildBackendApiUrl, SCAN_SOFT_DEADLINE_MS, MOBILITY_REFRESH_INTERVAL_MS, MOBILITY_NOTIFICATION_COOLDOWN_MS, MOBILITY_SWITCH_MIN_GAIN_SECONDS, MAX_FAVORITES, MAX_EMERGENCY_CONTACTS } from './config.js';
import { updateHeatmap, drawRoute, clearRouteDrawing, initMap, updateEmergencyMarkers, updateCameraMarkers, updatePropertyMarkers, updateRiskMarkers } from './map.js';
import { persistStoredArray, persistFavoriteLocations, persistEmergencyContacts } from './storage.js';
import { 
  fetchBackendSafetyAssessment, 
  fetchRouteDirections, 
  optimizeRouteAlternatives, 
  buildRouteBundle, 
  getDistance, 
  mapOsrmRouteCandidate, 
  getHeatmapData,
  fetchNearbyAmenities,
  fetchNearbyCameras,
  fetchNearbyProperties,
  reverseGeocode,
  fetchPublicSafetyRisk,
  EMERGENCY_NUMBERS,
  mergeRiskDataWithBackendAssessment
} from './api.js';
export
// ── Load Area Data from APIs (Progressive) ───────────────────
async function loadAreaData(lat, lng) {
  if (state.isFetching) return;
  state.isFetching = true;
  state.hasApiErrors = false;
  showStatus('Scanning area...');
  state.currentMapCenter = [lat, lng];

  // Use defaults so partial results can render immediately
  let services = {
    police: [],
    hospital: [],
    fire: []
  };
  let cameras = [];
  let properties = [];
  let areaInfo = {
    name: 'Loading...',
    fullAddress: '',
    area: '',
    type: 'unknown',
    category: 'unknown',
    countryCode: 'IN'
  };
  let riskData = null;
  let sidebarRendered = false;
  function tryRenderSidebar() {
    state.lastFetchedServices = services;
    state.lastFetchedCameras = cameras;
    state.lastFetchedProperties = properties;
    state.lastAreaInfo = areaInfo;
    state.lastRiskData = riskData;
    updateEmergencyMarkers(services);
    updateCameraMarkers(cameras);
    updatePropertyMarkers(properties);
    updateRiskMarkers(riskData);
    updateHeatmap();
    sidebarRendered = true;
  }

  // Fire all API calls concurrently, handle each as it arrives
  const servicesP = fetchNearbyAmenities(lat, lng, 3000).then(r => {
    services = r;
    updateEmergencyMarkers(services);
  }).catch(e => {
    console.warn('Amenities:', e);
    state.hasApiErrors = true;
  });
  const camerasP = fetchNearbyCameras(lat, lng, 2000).then(r => {
    cameras = Array.isArray(r) ? r : r.cameras || [];
    updateCameraMarkers(cameras);
  }).catch(e => {
    console.warn('Cameras:', e);
    state.hasApiErrors = true;
  });
  const propsP = fetchNearbyProperties(lat, lng, 2000).then(r => {
    properties = r;
    updatePropertyMarkers(properties);
  }).catch(e => {
    console.warn('Properties:', e);
  });
  const geoP = reverseGeocode(lat, lng).then(r => {
    areaInfo = r;
  }).catch(e => {
    console.warn('Geocode:', e);
    state.hasApiErrors = true;
  });
  const riskP = fetchPublicSafetyRisk(lat, lng).then(r => {
    riskData = r;
    if (r && r.criticalError) state.hasApiErrors = true;
    updateRiskMarkers(riskData);
  }).catch(e => {
    console.warn('Risk:', e);
    state.hasApiErrors = true;
  });
  const backendAssessmentP = Promise.allSettled([servicesP, camerasP, geoP, riskP]).then(() => enrichRiskDataWithBackendAssessment(lat, lng, state.currentHour, services, cameras, areaInfo, riskData)).then(enriched => {
    if (!enriched || typeof enriched !== 'object') return;
    riskData = enriched;
    updateRiskMarkers(riskData);
  }).catch(err => {
    console.warn('Backend assessment:', err);
  });

  // Hard deadline: after 5 seconds, render whatever we have
  const deadline = new Promise(resolve => setTimeout(resolve, 5000));

  // Wait for EITHER all APIs to finish OR the deadline
  await Promise.race([Promise.allSettled([servicesP, camerasP, propsP, geoP, riskP]), deadline]);

  // Render the sidebar with whatever data we have so far
  tryRenderSidebar();
  updateHeatmap();
  showStatus('');
  if (state.hasApiErrors) {
    showNotification('⚠️ Some feeds are unavailable. Showing best available estimates.', 'warning', 5000);
  }

  // Let remaining calls finish in background and update silently
  Promise.allSettled([servicesP, camerasP, propsP, geoP, riskP]).then(() => {
    state.lastFetchedServices = services;
    state.lastFetchedCameras = cameras;
    state.lastFetchedProperties = properties;
    state.lastAreaInfo = areaInfo;
    state.lastRiskData = riskData;
    updateHeatmap();
  });
  Promise.allSettled([backendAssessmentP]).then(() => {
    state.lastRiskData = riskData;
    updateRiskMarkers(riskData);
    updateHeatmap();
  });
  state.isFetching = false;
}
export function tryRenderSidebar() {
  state.lastFetchedServices = services;
  state.lastFetchedCameras = cameras;
  state.lastFetchedProperties = properties;
  state.lastAreaInfo = areaInfo;
  state.lastRiskData = riskData;
  updateEmergencyMarkers(services);
  updateCameraMarkers(cameras);
  updatePropertyMarkers(properties);
  updateRiskMarkers(riskData);
  updateHeatmap();
  sidebarRendered = true;
}
export function compactServicePayload(services, key, limit = 6) {
  const list = services && Array.isArray(services[key]) ? services[key] : [];
  return list.slice(0, limit).map((item, index) => ({
    id: item && item.id ? String(item.id) : `${key}_${index + 1}`,
    distance: Math.max(0, Number(item && item.distance || 0)),
    status: item && item.status ? String(item.status) : undefined
  }));
}
export function buildBackendSafetyPayload(lat, lng, hour, services, cameras, areaInfo, riskData) {
  const normalizedHour = Number.isFinite(Number(hour)) ? Number(hour) : new Date().getHours();
  const cameraArray = Array.isArray(cameras) ? cameras : cameras && Array.isArray(cameras.cameras) ? cameras.cameras : [];
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
export async function enrichRiskDataWithBackendAssessment(lat, lng, hour, services, cameras, areaInfo, riskData) {
  if (typeof fetchBackendSafetyAssessment !== 'function' || typeof mergeRiskDataWithBackendAssessment !== 'function') {
    return riskData;
  }
  const payload = buildBackendSafetyPayload(lat, lng, hour, services, cameras, areaInfo, riskData);
  const backendAssessment = await withTimeoutFallback(fetchBackendSafetyAssessment(payload), 5400, null, 'Backend product-grade scoring');
  if (!backendAssessment) {
    return riskData;
  }
  return mergeRiskDataWithBackendAssessment(riskData, backendAssessment);
}

// ── Map Click Handler ─────────────────────────────────────────
export function refreshSelectedSidebar() {
  if (!state.selectedMarker || !state.lastFetchedServices || !state.lastAreaInfo) return;
  const pos = state.selectedMarker.getLatLng();
  const scoreData = calculateSafetyScore(state.currentHour, state.lastFetchedServices, state.lastFetchedCameras, state.lastAreaInfo, state.lastRiskData, {
    lat: pos.lat,
    lng: pos.lng
  });
  const level = getSafetyLevel(scoreData.score);
  const riskOutput = generateRiskFactors(state.currentHour, state.lastFetchedServices, state.lastFetchedCameras, state.lastAreaInfo, state.lastRiskData);
  updateSidebar(scoreData.score, level, state.lastAreaInfo, state.lastFetchedServices, state.lastFetchedCameras, riskOutput.risks, riskOutput.features, pos.lat, pos.lng, scoreData.factors, state.lastRiskData);
}
export function showSidebarLoading() {
  document.getElementById('sidebarContent').innerHTML = `
    <div style="text-align:center; padding: 60px 20px;">
      <div class="loading-spinner" style="margin: 0 auto 16px;"></div>
      <p style="color: var(--text-muted); font-size: 14px;">Scanning area...</p>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">Fetching services, incidents, and local context</p>
    </div>
  `;
}
export function normalizeHourValue(hour) {
  const numericHour = Number(hour);
  if (!Number.isFinite(numericHour)) return new Date().getHours();
  return (Math.round(numericHour) % 24 + 24) % 24;
}
export function getConfidenceTone(confidenceValue) {
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
export function buildSafetyOutlookSummary(hour, services, cameras, areaInfo, riskData) {
  const normalizedHour = normalizeHourValue(hour);
  const projectionRiskData = riskData && typeof riskData === 'object' && riskData.productAssessment ? {
    ...riskData,
    productAssessment: null
  } : riskData;
  const nowProjection = calculateSafetyScore(normalizedHour, services, cameras, areaInfo, projectionRiskData);
  const baseScore = Number.isFinite(Number(nowProjection && nowProjection.score)) ? Number(nowProjection.score) : 50;
  const windows = [{
    offset: 0,
    label: 'Now'
  }, {
    offset: 1,
    label: '+1 hour'
  }, {
    offset: 3,
    label: '+3 hours'
  }];
  return windows.map(windowItem => {
    const projectedHour = (normalizedHour + windowItem.offset) % 24;
    const scoreData = calculateSafetyScore(projectedHour, services, cameras, areaInfo, projectionRiskData);
    const projectedScore = Number.isFinite(Number(scoreData && scoreData.score)) ? Math.round(Number(scoreData.score)) : Math.round(baseScore);
    const delta = projectedScore - Math.round(baseScore);
    const deltaLabel = delta === 0 ? 'Stable trend' : `${delta > 0 ? '+' : ''}${delta} vs now`;
    return {
      label: `${windowItem.label} (${formatTime(projectedHour)})`,
      score: projectedScore,
      deltaLabel,
      stateClass: delta >= 4 ? 'safer' : delta <= -4 ? 'riskier' : 'steady'
    };
  });
}
export function buildEmergencyReadinessSummary(services, activeCameraCount) {
  const nearestPolice = Array.isArray(services && services.police) && services.police.length > 0 ? services.police[0] : null;
  const nearestHospital = Array.isArray(services && services.hospital) && services.hospital.length > 0 ? services.hospital[0] : null;
  const nearestFire = Array.isArray(services && services.fire) && services.fire.length > 0 ? services.fire[0] : null;
  let score = 100;
  const policeDistance = Number(nearestPolice && nearestPolice.distance);
  if (!nearestPolice) score -= 34;else if (Number.isFinite(policeDistance) && policeDistance > 2500) score -= 22;else if (Number.isFinite(policeDistance) && policeDistance > 1500) score -= 12;else if (Number.isFinite(policeDistance) && policeDistance > 900) score -= 6;
  const hospitalDistance = Number(nearestHospital && nearestHospital.distance);
  if (!nearestHospital) score -= 30;else if (Number.isFinite(hospitalDistance) && hospitalDistance > 2500) score -= 20;else if (Number.isFinite(hospitalDistance) && hospitalDistance > 1500) score -= 10;else if (Number.isFinite(hospitalDistance) && hospitalDistance > 900) score -= 4;
  const fireDistance = Number(nearestFire && nearestFire.distance);
  if (!nearestFire) score -= 18;else if (Number.isFinite(fireDistance) && fireDistance > 2800) score -= 12;else if (Number.isFinite(fireDistance) && fireDistance > 1800) score -= 7;else if (Number.isFinite(fireDistance) && fireDistance > 1000) score -= 3;
  if (activeCameraCount === 0) score -= 14;else if (activeCameraCount < 2) score -= 8;
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
export function buildSafetyChecklist(hour, nearestPolice, nearestHospital, activeCameraCount) {
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
export function updateSidebar(score, level, areaInfo, services, cameras, risks, features, lat, lng, factors, riskData) {
  const scoreColor = level.class === 'very-safe' ? '#22c55e' : level.class === 'moderate' ? '#eab308' : level.class === 'caution' ? '#f97316' : '#ef4444';
  const nums = EMERGENCY_NUMBERS[state.currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const cameraArray = Array.isArray(cameras) ? cameras : cameras.cameras || [];
  const activeCams = cameraArray.filter(c => c.status === 'active');
  const safeAreaName = escapeJsString(areaInfo.name || 'Selected location');
  const crimeSourceLabel = riskData ? formatIncidentSourceLabel(riskData.sources && riskData.sources.crime) : 'Unavailable';
  const accidentSourceLabel = riskData ? formatIncidentSourceLabel(riskData.sources && riskData.sources.accidents) : 'Unavailable';
  const riskReliability = riskData && Number.isFinite(Number(riskData.reliabilityScore)) ? Math.round(Number(riskData.reliabilityScore)) : null;
  const crimeQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.crime)) ? Math.round(Number(riskData.dataQuality.crime)) : null;
  const accidentQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.accidents)) ? Math.round(Number(riskData.dataQuality.accidents)) : null;
  const cvQuality = riskData && riskData.dataQuality && Number.isFinite(Number(riskData.dataQuality.cv)) ? Math.round(Number(riskData.dataQuality.cv)) : null;
  const cvSourceLabel = riskData && riskData.sources ? formatIncidentSourceLabel(riskData.sources.cv) : 'Unavailable';
  const cvRiskScore = riskData && riskData.cvSignals && Number.isFinite(Number(riskData.cvSignals.score)) ? Math.round(Number(riskData.cvSignals.score)) : null;
  const cvRiskLevel = riskData && riskData.cvSignals ? String(riskData.cvSignals.level || 'low') : 'low';
  const productScore = riskData && riskData.productAssessment && Number.isFinite(Number(riskData.productAssessment.score)) ? Math.round(Number(riskData.productAssessment.score)) : null;
  const productModel = riskData && riskData.productAssessment ? String(riskData.productAssessment.model || 'safezone-product-risk-v1') : '';
  const deploymentGrade = riskData && riskData.productAssessment && riskData.productAssessment.deploymentReadiness ? String(riskData.productAssessment.deploymentReadiness.grade || '') : '';
  const usesProxyRisk = Boolean(riskData && riskData.sources && (String(riskData.sources.crime || '').includes('proxy') || String(riskData.sources.accidents || '').includes('proxy')));
  const safeLat = safeMapCoordinate(lat, -90, 90);
  const safeLng = safeMapCoordinate(lng, -180, 180);
  const normalizedHour = normalizeHourValue(state.currentHour);
  const confidenceTone = getConfidenceTone(riskData && riskData.confidence);
  const safetyOutlook = buildSafetyOutlookSummary(normalizedHour, services, cameraArray, areaInfo, riskData);
  const nearestPolice = Array.isArray(services.police) && services.police.length > 0 ? services.police[0] : null;
  const nearestHospital = Array.isArray(services.hospital) && services.hospital.length > 0 ? services.hospital[0] : null;
  const nearestFire = Array.isArray(services.fire) && services.fire.length > 0 ? services.fire[0] : null;
  const readinessSummary = buildEmergencyReadinessSummary(services, activeCams.length);
  const readinessChecklist = buildSafetyChecklist(normalizedHour, nearestPolice, nearestHospital, activeCams.length);
  const snapshotReasons = [...(Array.isArray(risks) ? risks : []), ...(Array.isArray(factors) ? factors : [])].map(item => normalizeDisplayText(item, 120)).filter(Boolean).slice(0, 3);
  const snapshotActionsRaw = Array.isArray(riskData && riskData.recommendations) && riskData.recommendations.length > 0 ? riskData.recommendations : Array.isArray(features) ? features : [];
  const snapshotActions = snapshotActionsRaw.map(item => normalizeDisplayText(item, 110)).filter(Boolean).slice(0, 2);
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
  const nearestHospitalLat = nearestHospital ? safeMapCoordinate(nearestHospital.lat, -90, 90) : null;
  const nearestHospitalLng = nearestHospital ? safeMapCoordinate(nearestHospital.lng, -180, 180) : null;
  const nearestHospitalName = nearestHospital ? escapeJsString(nearestHospital.name || 'Nearest hospital') : '';
  if (snapshotReasons.length === 0) {
    snapshotReasons.push('No major risk signals detected for this location at this time.');
  }
  const isFavorite = state.favoriteLocations.some(fav => Math.abs(fav.lat - safeLat) < 0.0001 && Math.abs(fav.lng - safeLng) < 0.0001);
  document.getElementById('sidebarContent').innerHTML = `
    ${state.hasApiErrors ? `
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
          ${safetyOutlook.map(windowItem => `
            <div class="snapshot-outlook-tile ${windowItem.stateClass}">
              <div class="outlook-window">${escapeHtml(windowItem.label)}</div>
              <div class="outlook-score">${windowItem.score}</div>
              <div class="outlook-meta">${escapeHtml(windowItem.deltaLabel)}</div>
            </div>
          `).join('')}
        </div>

        <div class="snapshot-list">
          ${snapshotReasons.map(reason => `<div class="snapshot-list-item">${escapeHtml(reason)}</div>`).join('')}
        </div>

        ${snapshotActions.length > 0 ? `
          <div class="snapshot-chips">
            ${snapshotActions.map(action => `<span class="snapshot-chip">${escapeHtml(action)}</span>`).join('')}
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

    ${function () {
    if (typeof getNcrbCrimeRate !== 'function') return '';
    const ncrbResult = getNcrbCrimeRate(safeLat, safeLng);
    if (!ncrbResult) return '';
    const r = ncrbResult.rates;
    const riskColor = ncrbResult.riskIndex > 2.0 ? '#ef4444' : ncrbResult.riskIndex > 1.3 ? '#f97316' : ncrbResult.riskIndex > 0.9 ? '#eab308' : '#22c55e';
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
  }()}

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
          ${readinessChecklist.map(item => `<div class="checklist-item">- ${escapeHtml(item)}</div>`).join('')}
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
      <div class="section-title"><span class="icon">📞</span> Emergency Numbers (${escapeHtml(nums.country || state.currentCountryCode)})</div>
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
            <div class="service-meta">${escapeHtml(c.resolution)} • ${c.status === 'active' ? '<span style="color:#22c55e">● Online</span>' : '<span style="color:#eab308">● Maintenance</span>'}${c.source === 'openstreetmap' ? ' • 📡 OSM' : c.source === 'google-places' ? ' • 🗺 Google' : ' • ⚠ Est.'}</div>
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
            <div class="service-meta">📞 ${escapeHtml(p.phone)}${p.source === 'openstreetmap' ? ' • 📡 Verified' : p.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.'}</div>
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
            <div class="service-meta">📞 ${escapeHtml(h.phone)}${h.source === 'openstreetmap' ? ' • 📡 Verified' : h.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.'}</div>
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
            <div class="service-meta">📞 ${escapeHtml(f.phone)}${f.source === 'openstreetmap' ? ' • 📡 Verified' : f.source === 'google-places' ? ' • 🗺 Google Places' : ' • ⚠ Est.'}</div>
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
export function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
}
export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  if (state.selectedMarker) {
    state.map.removeLayer(state.selectedMarker);
    state.selectedMarker = null;
  }
}

// ── Time Slider ───────────────────────────────────────────────
export async function onTimeChange(value) {
  state.currentHour = parseInt(value, 10);
  updateTimeDisplay();
  const slider = document.getElementById('timeSlider');
  slider.setAttribute('aria-valuenow', state.currentHour);
  updateHeatmap();
  refreshSelectedSidebar();
  if (state.activeRoute && state.routeDestination) {
    refreshMobilityIntelligence({
      notify: false,
      keepViewport: true
    });
  }
}
export function updateTimeDisplay() {
  document.getElementById('timeDisplay').textContent = formatTime(state.currentHour);
}

// ── Favorite Locations ────────────────────────────────────────
export function toggleFavorite(lat, lng, name) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng) || safeLat < -90 || safeLat > 90 || safeLng < -180 || safeLng > 180) {
    showNotification('Unable to save this location. Coordinates are invalid.', 'error', 2600);
    return;
  }
  const index = state.favoriteLocations.findIndex(fav => Math.abs(fav.lat - safeLat) < 0.0001 && Math.abs(fav.lng - safeLng) < 0.0001);
  if (index > -1) {
    state.favoriteLocations.splice(index, 1);
    showNotification('📍 Location removed from favorites', 'info', 2000);
  } else {
    if (state.favoriteLocations.length >= MAX_FAVORITES) {
      showNotification(`You can store up to ${MAX_FAVORITES} favorite locations.`, 'warning', 2800);
      return;
    }
    state.favoriteLocations.push({
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
export function findSafestHomes() {
  if (!state.lastFetchedProperties || state.lastFetchedProperties.length === 0) {
    showNotification('No properties found nearby. Please search a new area.', 'warning');
    return;
  }
  showStatus('Scoring properties for safety...');
  let bestProp = null;
  let bestScore = -1;
  state.lastFetchedProperties.forEach(prop => {
    const scoreData = calculateSafetyScore(state.currentHour, state.lastFetchedServices, state.lastFetchedCameras, state.lastAreaInfo, state.lastRiskData, {
      lat: prop.lat,
      lng: prop.lng
    });
    let propScore = scoreData.score;
    const policeDist = state.lastFetchedServices.police.length > 0 ? getDistance(prop.lat, prop.lng, state.lastFetchedServices.police[0].lat, state.lastFetchedServices.police[0].lng) : 5000;
    if (policeDist < 300) propScore += 12;else if (policeDist < 800) propScore += 6;
    if (propScore > bestScore) {
      bestScore = propScore;
      bestProp = prop;
    }
  });
  if (bestProp) {
    setTimeout(() => {
      showStatus('');
      showNotification(`🏆 Safest Home Found! Estimated Score: ${Math.min(100, Math.floor(bestScore))}/100`, 'success', 5000);
      state.map.flyTo([bestProp.lat, bestProp.lng], 17);
      setTimeout(() => {
        onMapClick({
          latlng: {
            lat: bestProp.lat,
            lng: bestProp.lng
          }
        });
        state.propertiesLayerGroup.eachLayer(layer => {
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
export function toggleLayer(type) {
  const btn = document.querySelector(`[data-layer="${type}"]`);
  switch (type) {
    case 'heatmap':
      state.layerState.heatmap = !state.layerState.heatmap;
      if (state.layerState.heatmap) state.heatLayer.addTo(state.map);else state.map.removeLayer(state.heatLayer);
      break;
    case 'cameras':
      state.layerState.cameras = !state.layerState.cameras;
      if (state.layerState.cameras) state.cameraLayerGroup.addTo(state.map);else state.map.removeLayer(state.cameraLayerGroup);
      break;
    case 'emergency':
      state.layerState.emergency = !state.layerState.emergency;
      if (state.layerState.emergency) state.emergencyLayerGroup.addTo(state.map);else state.map.removeLayer(state.emergencyLayerGroup);
      break;
    case 'properties':
      state.layerState.properties = !state.layerState.properties;
      if (state.layerState.properties) state.propertiesLayerGroup.addTo(state.map);else state.map.removeLayer(state.propertiesLayerGroup);
      break;
    case 'risk':
      state.layerState.risk = !state.layerState.risk;
      if (state.layerState.risk) state.riskLayerGroup.addTo(state.map);else state.map.removeLayer(state.riskLayerGroup);
      break;
  }
  if (btn) {
    btn.classList.toggle('active', state.layerState[type]);
    btn.setAttribute('aria-pressed', state.layerState[type]);
  }
  const layerName = type.charAt(0).toUpperCase() + type.slice(1);
  showNotification(`${state.layerState[type] ? '✓' : '✗'} ${layerName} layer ${state.layerState[type] ? 'enabled' : 'disabled'}`, 'info', 1500);
}

// ── Search + Voice Search ─────────────────────────────────────
export function normalizeSearchQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
export function getCountryNameFromCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return '';
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const regionNames = new Intl.DisplayNames(['en'], {
        type: 'region'
      });
      const countryName = regionNames.of(normalized);
      if (countryName) return countryName;
    } catch (err) {
      console.warn('Country name lookup failed:', err);
    }
  }
  return normalized;
}
export function buildGeocodeQueryVariants(query) {
  const normalized = normalizeSearchQuery(query);
  const variants = [];
  const addVariant = value => {
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
  const areaHint = normalizeSearchQuery(state.lastAreaInfo && state.lastAreaInfo.area);
  const localityHint = normalizeSearchQuery(state.lastAreaInfo && state.lastAreaInfo.name);
  const countryHint = getCountryNameFromCode(typeof state.currentCountryCode === 'string' ? state.currentCountryCode : '');
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
export function buildSearchViewbox(center, delta = 0.18) {
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
export function buildNominatimSearchUrl(query, options = {}) {
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
export async function fetchNominatimCandidates(query, options = {}) {
  const url = buildNominatimSearchUrl(query, options);
  const request = typeof fetchWithTimeout === 'function' ? fetchWithTimeout(url, {
    headers: {
      'Accept-Language': 'en'
    }
  }, 9000) : fetch(url, {
    headers: {
      'Accept-Language': 'en'
    }
  });
  const response = await request;
  if (!response.ok) {
    throw new Error(`Geocode API returned ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}
export function scoreGeocodeCandidate(candidate, baseQuery) {
  const normalizedBase = normalizeSearchQuery(baseQuery).toLowerCase();
  const displayName = String(candidate.display_name || '').toLowerCase();
  const primaryLabel = displayName.split(',')[0].trim();
  const tokens = normalizedBase.split(/\s+/).filter(token => token.length > 2);
  let score = 0;
  if (primaryLabel === normalizedBase) score += 120;else if (primaryLabel.startsWith(normalizedBase)) score += 90;else if (displayName.includes(normalizedBase)) score += 60;
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
  if (typeof getDistance === 'function' && Number.isFinite(lat) && Number.isFinite(lng) && Array.isArray(state.currentMapCenter) && state.currentMapCenter.length >= 2) {
    const distanceKm = getDistance(state.currentMapCenter[0], state.currentMapCenter[1], lat, lng) / 1000;
    if (Number.isFinite(distanceKm)) {
      score += Math.max(0, 25 - Math.min(25, distanceKm));
    }
  }
  if (candidate._bounded) score += 8;
  const category = `${candidate.class || ''} ${candidate.type || ''}`.toLowerCase();
  if (/building|residential|house|apartments/.test(category)) score += 6;
  return score;
}
export async function geocodeQuery(query) {
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
  const countryCode = typeof state.currentCountryCode === 'string' ? state.currentCountryCode.toLowerCase() : '';
  const viewbox = buildSearchViewbox(state.currentMapCenter);
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
        candidates.push({
          ...item,
          _bounded: plan.bounded
        });
      }
      if (candidates.length >= 10) break;
    } catch (err) {
      console.warn('Geocode lookup attempt failed:', err);
    }
  }
  if (candidates.length === 0) return null;
  const ranked = candidates.map(candidate => ({
    candidate,
    score: scoreGeocodeCandidate(candidate, normalizedQuery)
  })).sort((a, b) => b.score - a.score);
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
export async function searchLocation() {
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
      state.map.flyTo([result.lat, result.lng], 15, {
        duration: 1.5
      });
      showNotification(`📍 Found: ${result.label}`, 'success', 3000);
      setTimeout(() => {
        onMapClick({
          latlng: {
            lat: result.lat,
            lng: result.lng
          }
        });
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
export function onSearchKeydown(e) {
  if (e.key === 'Enter') searchLocation();
}
export function handleVoiceCommand(transcript) {
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
export function setVoiceSearchState(active) {
  const btn = document.getElementById('voiceSearchBtn');
  if (!btn) return;
  btn.classList.toggle('active', active);
  btn.textContent = active ? '🛑' : '🎤';
  state.isVoiceListening = active;
}
export function toggleVoiceSearch() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    showNotification('Voice recognition is not supported in this browser.', 'warning', 3000);
    return;
  }
  if (state.isVoiceListening && state.speechRecognition) {
    state.speechRecognition.stop();
    return;
  }
  state.speechRecognition = new SpeechRecognitionCtor();
  state.speechRecognition.lang = 'en-US';
  state.speechRecognition.interimResults = true;
  state.speechRecognition.maxAlternatives = 1;
  let finalTranscript = '';
  state.speechRecognition.onstart = () => {
    setVoiceSearchState(true);
    showNotification('🎤 Listening... Say a place or say "navigate to ..."', 'info', 2500);
  };
  state.speechRecognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      }
    }
  };
  state.speechRecognition.onerror = event => {
    console.warn('Voice recognition error:', event.error);
    if (event.error !== 'no-speech') {
      showNotification('Voice recognition failed. Please try again.', 'error', 2500);
    }
  };
  state.speechRecognition.onend = () => {
    setVoiceSearchState(false);
    if (finalTranscript.trim()) {
      handleVoiceCommand(finalTranscript.trim());
    }
  };
  state.speechRecognition.start();
}

// ── Directions + Voice Navigation ─────────────────────────────
export function openDirectionsPanel() {
  document.getElementById('directionsPanel').classList.add('open');
  if (state.activeRoute && state.routeDestination) {
    startMobilityRefreshLoop();
  }
}
export function closeDirectionsPanel() {
  document.getElementById('directionsPanel').classList.remove('open');
  stopMobilityRefreshLoop();
  stopVoiceNavigation();
}
export function getSelectedRouteMode() {
  const select = document.getElementById('routeModeSelect');
  const value = select ? String(select.value || 'balanced').trim().toLowerCase() : 'balanced';
  if (value === 'fastest' || value === 'safest' || value === 'least-congested') {
    return value;
  }
  return 'balanced';
}
export function getRouteModeLabel(mode) {
  const key = String(mode || 'balanced').trim().toLowerCase();
  return ROUTE_MODE_LABELS[key] || ROUTE_MODE_LABELS.balanced;
}
export function getEdgeAISignal() {
  if (typeof EdgeAI === 'undefined' || typeof EdgeAI.isActive !== 'function') {
    return {
      active: false,
      anomalyScore: 0
    };
  }
  const active = Boolean(EdgeAI.isActive());
  const anomalyScore = active && typeof EdgeAI.getAnomalyScore === 'function' ? Number(EdgeAI.getAnomalyScore()) : 0;
  return {
    active,
    anomalyScore: Number.isFinite(anomalyScore) ? Math.max(0, anomalyScore) : 0
  };
}
export function getRouteMobilityInsight(route, congestion, mode, edgeAiSignal = {
  active: false,
  anomalyScore: 0
}) {
  const routeMode = getRouteModeLabel(mode);
  const level = getCongestionClass(congestion && congestion.level);
  const score = Number.isFinite(congestion && congestion.score) ? Math.round(congestion.score) : 50;
  const edgeScore = Number.isFinite(edgeAiSignal.anomalyScore) ? Math.round(edgeAiSignal.anomalyScore) : 0;
  const isSafer = level === 'low' || routeMode === 'Safest' || route && Number(route.safetyPenalty || 0) <= 18;
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
    congestion.factors.slice(0, 3).forEach(factor => factorList.push(factor));
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
export function getCongestionClass(level) {
  const key = String(level || 'moderate').toLowerCase();
  if (key === 'low' || key === 'high' || key === 'severe') return key;
  return 'moderate';
}
export function getCongestionLabel(congestion) {
  if (!congestion || typeof congestion !== 'object') return 'Moderate congestion';
  const level = getCongestionClass(congestion.level);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  const score = Number.isFinite(congestion.score) ? Math.round(congestion.score) : 50;
  return `${levelLabel} congestion (${score}/100)`;
}
export function getRouteEtaSeconds(candidate) {
  if (!candidate) return 0;
  const congestion = candidate.congestion || {};
  if (Number.isFinite(congestion.etaSeconds)) {
    return Math.max(Number(candidate.duration || 0), Number(congestion.etaSeconds || 0));
  }
  return Math.max(0, Number(candidate.duration || 0));
}
export function getRouteRefreshAgeLabel() {
  if (!state.lastMobilityRefreshAt) return 'Live update pending';
  const ageSeconds = Math.max(0, Math.round((Date.now() - state.lastMobilityRefreshAt) / 1000));
  if (ageSeconds <= 1) return 'Updated just now';
  return `Updated ${ageSeconds}s ago`;
}
export function syncActiveRouteSelection(routeData, selectedId) {
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
export function stopMobilityRefreshLoop() {
  if (state.mobilityRefreshTimerId !== null) {
    clearInterval(state.mobilityRefreshTimerId);
    state.mobilityRefreshTimerId = null;
  }
}
export function startMobilityRefreshLoop() {
  stopMobilityRefreshLoop();
  if (!state.activeRoute || !state.routeDestination) return;
  state.mobilityRefreshTimerId = setInterval(() => {
    refreshMobilityIntelligence({
      notify: true,
      keepViewport: true
    });
  }, MOBILITY_REFRESH_INTERVAL_MS);
}
export function refreshMobilityIntelligence(options = {}) {
  if (!state.activeRoute || !state.routeDestination || !Array.isArray(state.activeRoute.alternatives) || state.activeRoute.alternatives.length === 0) {
    return false;
  }
  if (typeof optimizeRouteAlternatives !== 'function') {
    return false;
  }
  const selectedRouteId = String(state.activeRoute.selectedRouteId || '');
  const mode = state.activeRoute.optimizationMode || getSelectedRouteMode();
  const edgeAiSignal = getEdgeAISignal();
  const baseAlternatives = state.activeRoute.alternatives.map((candidate, index) => ({
    id: String(candidate.id || `route_${index + 1}`),
    label: String(candidate.label || `Route ${String.fromCharCode(65 + index % 26)}`),
    source: String(candidate.source || state.activeRoute.source || 'mobility-refresh'),
    distance: Math.max(0, Number(candidate.distance || 0)),
    duration: Math.max(0, Number(candidate.duration || 0)),
    path: Array.isArray(candidate.path) ? candidate.path : [],
    steps: Array.isArray(candidate.steps) ? candidate.steps : []
  })).filter(candidate => candidate.path.length > 1 || candidate.steps.length > 0);
  if (!baseAlternatives.length) {
    return false;
  }
  const optimized = optimizeRouteAlternatives(baseAlternatives, mode, 'driving', {
    hour: state.currentHour,
    riskData: state.lastRiskData,
    edgeAiScore: edgeAiSignal.anomalyScore,
    edgeAiActive: edgeAiSignal.active
  });
  if (!optimized || !Array.isArray(optimized.alternatives) || optimized.alternatives.length === 0) {
    return false;
  }
  state.activeRoute.optimizationMode = optimized.mode;
  state.activeRoute.alternatives = optimized.alternatives;
  const preferredSelection = state.activeRoute.alternatives.some(candidate => candidate.id === selectedRouteId) ? selectedRouteId : optimized.selectedRouteId;
  const activeCandidate = syncActiveRouteSelection(state.activeRoute, preferredSelection);
  if (!activeCandidate) {
    return false;
  }
  state.lastMobilityRefreshAt = Date.now();
  const recommendedCandidate = state.activeRoute.alternatives[0] || activeCandidate;
  const etaGainSeconds = Math.max(0, getRouteEtaSeconds(activeCandidate) - getRouteEtaSeconds(recommendedCandidate));
  const shouldSuggestSwitch = Boolean(recommendedCandidate) && recommendedCandidate.id !== activeCandidate.id && etaGainSeconds >= MOBILITY_SWITCH_MIN_GAIN_SECONDS;
  if (options.notify && shouldSuggestSwitch) {
    const now = Date.now();
    if (now - state.lastMobilitySuggestionAt >= MOBILITY_NOTIFICATION_COOLDOWN_MS || state.lastMobilitySuggestedRouteId !== recommendedCandidate.id) {
      showNotification(`⚡ Better route detected: ${recommendedCandidate.label} can save ${formatDuration(etaGainSeconds)}.`, 'info', 4200);
      state.lastMobilitySuggestionAt = now;
      state.lastMobilitySuggestedRouteId = recommendedCandidate.id;
    }
  }
  if (options.redraw !== false) {
    drawRoute(state.activeRoute, {
      preserveViewport: options.keepViewport !== false
    });
  }
  renderDirectionsPanel(state.activeRoute, state.routeDestination.label);
  return true;
}
export function refreshMobilityInsightNow() {
  const refreshed = refreshMobilityIntelligence({
    notify: false,
    keepViewport: true
  });
  if (!refreshed) {
    showNotification('No active route is available to refresh.', 'warning', 2200);
    return;
  }
  showNotification('Mobility insight refreshed.', 'success', 1800);
}
export function applyRecommendedRoute() {
  if (!state.activeRoute || !Array.isArray(state.activeRoute.alternatives) || state.activeRoute.alternatives.length === 0) {
    showNotification('Create a route first to apply AI recommendation.', 'warning', 2500);
    return;
  }
  const recommended = state.activeRoute.alternatives.find(candidate => candidate.isRecommended) || state.activeRoute.alternatives[0];
  if (!recommended) {
    showNotification('No AI recommendation is available right now.', 'warning', 2200);
    return;
  }
  if (recommended.id === state.activeRoute.selectedRouteId) {
    showNotification('You are already on the best available route.', 'success', 1800);
    return;
  }
  selectRouteAlternative(recommended.id);
}
export function getCurrentLocation() {
  const mapCenterFallback = {
    lat: state.currentMapCenter[0],
    lng: state.currentMapCenter[1],
    source: 'map-center'
  };
  return new Promise(resolve => {
    let settled = false;
    let fallbackTimerId = null;
    const resolveOnce = value => {
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
          const accuracyNote = approx.accuracy ? ` (~${Math.round(approx.accuracy)}m accuracy)` : '';
          showNotification(`Using approximate Google location${accuracyNote} as start point.`, 'warning', 4200);
          return resolveOnce({
            lat: approx.lat,
            lng: approx.lng,
            source: 'google-approximate'
          });
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
      resolveWithGoogleApproximation().then(resolvedFromGoogle => {
        if (resolvedFromGoogle) return;
        showNotification('Geolocation is unavailable. Using current map center as start point.', 'warning', 4000);
        resolveOnce(mapCenterFallback);
      });
      return;
    }

    // Do not block route startup for long geolocation timeouts.
    fallbackTimerId = setTimeout(() => {
      resolveWithGoogleApproximation().then(resolvedFromGoogle => {
        if (resolvedFromGoogle) return;
        showNotification('Location lookup is slow. Using current map center as start point.', 'warning', 3600);
        resolveOnce(mapCenterFallback);
      });
    }, 3200);
    navigator.geolocation.getCurrentPosition(pos => {
      if (settled) return;
      resolveOnce({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        source: 'device'
      });
    }, async error => {
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
    }, {
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 15000
    });
  });
}
export function renderDirectionsPanel(route, destinationLabel) {
  const content = document.getElementById('directionsContent');
  if (!content) return;
  const alternatives = Array.isArray(route.alternatives) && route.alternatives.length > 0 ? route.alternatives : [{
    id: 'route_primary',
    label: 'Primary route',
    distance: route.distance,
    duration: route.duration,
    path: route.path,
    steps: route.steps,
    congestion: route.congestion || {
      level: 'moderate',
      score: 50,
      delaySeconds: 0,
      etaSeconds: route.duration,
      confidence: 'low'
    }
  }];
  const activeCandidate = getActiveRouteAlternative({
    ...route,
    alternatives
  });
  if (!activeCandidate) {
    content.innerHTML = '<p class="directions-empty">No route candidates are available right now.</p>';
    return;
  }
  const activeCongestion = activeCandidate.congestion || {
    level: 'moderate',
    score: 50,
    delaySeconds: 0,
    etaSeconds: activeCandidate.duration
  };
  const edgeAiSignal = getEdgeAISignal();
  const mobilityInsight = getRouteMobilityInsight(activeCandidate, activeCongestion, route.optimizationMode || getSelectedRouteMode(), edgeAiSignal);
  const delaySeconds = Number.isFinite(activeCongestion.delaySeconds) ? Math.max(0, activeCongestion.delaySeconds) : 0;
  const etaSeconds = Number.isFinite(activeCongestion.etaSeconds) ? Math.max(activeCandidate.duration || 0, activeCongestion.etaSeconds) : activeCandidate.duration || 0;
  const recommendedCandidate = alternatives.find(candidate => candidate.isRecommended) || alternatives[0] || activeCandidate;
  const etaGainSeconds = Math.max(0, getRouteEtaSeconds(activeCandidate) - getRouteEtaSeconds(recommendedCandidate));
  const shouldSwitch = recommendedCandidate && recommendedCandidate.id !== activeCandidate.id && etaGainSeconds >= MOBILITY_SWITCH_MIN_GAIN_SECONDS;
  const actionSummary = shouldSwitch ? `Switch to ${recommendedCandidate.label} to save about ${formatDuration(etaGainSeconds)}.` : 'Stay on the current route. It is already the best option right now.';
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
  const optionCardsMarkup = alternatives.map(candidate => {
    const candidateCongestion = candidate.congestion || {
      level: 'moderate',
      score: 50,
      delaySeconds: 0,
      etaSeconds: candidate.duration
    };
    const candidateDelay = Number.isFinite(candidateCongestion.delaySeconds) ? Math.max(0, candidateCongestion.delaySeconds) : 0;
    const candidateEta = Number.isFinite(candidateCongestion.etaSeconds) ? Math.max(candidate.duration || 0, candidateCongestion.etaSeconds) : candidate.duration || 0;
    const isActive = candidate.id === activeCandidate.id;
    const recommended = candidate.isRecommended ? '<span class="route-reco">Best</span>' : '';
    const scoreText = Number.isFinite(candidate.optimizationScore) ? `Opt score ${candidate.optimizationScore.toFixed(2)}` : '';
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
  const insightTagsMarkup = (mobilityInsight.factors || []).map(factor => `
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
        ${shouldSwitch ? '<button class="search-btn directions-btn ai-action-btn" onclick="applyRecommendedRoute()" aria-label="Apply AI recommended route change for better safety">⚡ Apply AI Recommendation</button>' : '<button class="search-btn ai-action-btn ai-action-secondary" onclick="refreshMobilityInsightNow()" aria-label="Refresh mobility insight and re-evaluate route conditions">↻ Refresh Mobility Insight</button>'}
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
export function selectRouteAlternative(routeId) {
  if (!state.activeRoute || !Array.isArray(state.activeRoute.alternatives) || state.activeRoute.alternatives.length === 0) {
    return;
  }
  const nextRoute = state.activeRoute.alternatives.find(candidate => candidate.id === routeId);
  if (!nextRoute) return;
  stopVoiceNavigation(false);
  state.activeRoute.selectedRouteId = nextRoute.id;
  state.activeRoute.selectedIndex = state.activeRoute.alternatives.findIndex(candidate => candidate.id === nextRoute.id);
  state.activeRoute.distance = nextRoute.distance;
  state.activeRoute.duration = nextRoute.duration;
  state.activeRoute.path = nextRoute.path;
  state.activeRoute.steps = nextRoute.steps;
  state.activeRoute.congestion = nextRoute.congestion;
  state.activeRoute.etaSeconds = getRouteEtaSeconds(nextRoute);
  state.lastMobilityRefreshAt = Date.now();
  state.lastMobilitySuggestedRouteId = '';
  state.routeStepIndex = 0;
  drawRoute(state.activeRoute);
  if (state.routeDestination) {
    renderDirectionsPanel(state.activeRoute, state.routeDestination.label);
  }
  showNotification(`Switched to ${nextRoute.label || 'selected route'} (${getCongestionLabel(nextRoute.congestion)})`, 'info', 2300);
}
export async function startDirectionsTo(lat, lng, label = 'Destination') {
  showStatus('Calculating route...');
  try {
    const origin = await getCurrentLocation();
    const routeMode = getSelectedRouteMode();
    const edgeAiSignal = getEdgeAISignal();
    const route = await fetchRouteDirections(origin.lat, origin.lng, lat, lng, 'driving', {
      mode: routeMode,
      hour: state.currentHour,
      riskData: state.lastRiskData,
      edgeAiScore: edgeAiSignal.anomalyScore,
      edgeAiActive: edgeAiSignal.active
    });
    state.activeRoute = route;
    state.routeDestination = {
      lat,
      lng,
      label
    };
    state.routeStepIndex = 0;
    state.lastMobilityRefreshAt = Date.now();
    state.lastMobilitySuggestionAt = 0;
    state.lastMobilitySuggestedRouteId = '';
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
export async function startDirectionsFromInput() {
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
    state.map.flyTo([result.lat, result.lng], 15, {
      duration: 1.2
    });
    setTimeout(() => {
      startDirectionsTo(result.lat, result.lng, result.label);
    }, 1000);
  } catch (err) {
    console.error('Destination lookup failed:', err);
    showNotification('❌ Destination lookup failed.', 'error', 3000);
  }
  showStatus('');
}
export function speakText(text, interrupt = false) {
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
export function speakRouteOverview() {
  if (!state.activeRoute || !state.routeDestination) {
    showNotification('No active route to narrate.', 'warning', 2000);
    return;
  }
  const congestion = state.activeRoute.congestion || {};
  const level = getCongestionClass(congestion.level);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  const etaSeconds = Number.isFinite(congestion.etaSeconds) ? Math.max(state.activeRoute.duration || 0, congestion.etaSeconds) : state.activeRoute.duration;
  const summary = `Route to ${state.routeDestination.label}. Distance ${formatDistance(state.activeRoute.distance)}. Base travel time ${formatDuration(state.activeRoute.duration)}. Predicted traffic ${levelLabel}. Estimated arrival in ${formatDuration(etaSeconds)}.`;
  speakText(summary, true);
}
export function highlightCurrentRouteStep(index) {
  const allSteps = document.querySelectorAll('.direction-step');
  allSteps.forEach(step => step.classList.remove('active'));
  const target = document.getElementById(`route-step-${index}`);
  if (target) {
    target.classList.add('active');
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }
}
export function startVoiceNavigation() {
  if (!state.activeRoute || !state.routeDestination || !state.activeRoute.steps.length) {
    showNotification('Create a route first to start voice guidance.', 'warning', 2500);
    return;
  }
  if (!navigator.geolocation) {
    showNotification('Geolocation is not available. Reading route steps instead.', 'warning', 3500);
    const preview = state.activeRoute.steps.slice(0, 8).map(s => s.voiceInstruction).join(' Then, ');
    speakText(preview, true);
    return;
  }
  stopVoiceNavigation(false);
  state.routeStepIndex = 0;
  highlightCurrentRouteStep(0);
  speakText('Voice guidance started. ' + state.activeRoute.steps[0].voiceInstruction, true);
  state.navigationWatchId = navigator.geolocation.watchPosition(position => {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    if (state.routeStepIndex < state.activeRoute.steps.length) {
      const step = state.activeRoute.steps[state.routeStepIndex];
      const stepDistance = getDistance(userLat, userLng, step.lat, step.lng);
      if (stepDistance <= 55) {
        speakText(step.voiceInstruction, true);
        highlightCurrentRouteStep(state.routeStepIndex);
        state.routeStepIndex += 1;
      }
    }
    const destinationDistance = getDistance(userLat, userLng, state.routeDestination.lat, state.routeDestination.lng);
    if (destinationDistance <= 45) {
      speakText('You have arrived at your destination.', true);
      stopVoiceNavigation(false);
    }
  }, () => {
    showNotification('Unable to track your location for voice navigation.', 'error', 3000);
    stopVoiceNavigation(false);
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 3000
  });
  showNotification('🎙 Voice guidance active', 'success', 2000);
}
export function stopVoiceNavigation(notify = true) {
  if (state.navigationWatchId !== null) {
    navigator.geolocation.clearWatch(state.navigationWatchId);
    state.navigationWatchId = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (notify) {
    showNotification('Voice guidance stopped.', 'info', 1500);
  }
}

// ── Emergency Contacts ────────────────────────────────────────
export function renderEmergencyContacts() {
  const list = document.getElementById('contactsList');
  if (!list) return;
  if (!state.emergencyContacts.length) {
    list.innerHTML = '<p class="contacts-empty">No emergency contacts added yet.</p>';
    return;
  }
  list.innerHTML = state.emergencyContacts.map(contact => `
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
export function openEmergencyContacts() {
  const modal = document.getElementById('contactsModal');
  modal.classList.add('open');
  renderEmergencyContacts();
}
export function closeEmergencyContacts() {
  const modal = document.getElementById('contactsModal');
  modal.classList.remove('open');
}
export function saveEmergencyContact(event) {
  event.preventDefault();
  const nameInput = document.getElementById('contactNameInput');
  const phoneInput = document.getElementById('contactPhoneInput');
  const name = normalizeDisplayText(nameInput.value, 40);
  const phone = sanitizePhoneNumber(phoneInput.value.trim());
  if (!name || !isValidPhoneNumber(phone)) {
    showNotification('Enter a valid contact name and phone number.', 'warning', 2500);
    return;
  }
  if (state.emergencyContacts.length >= MAX_EMERGENCY_CONTACTS) {
    showNotification(`You can store up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.`, 'warning', 3000);
    return;
  }
  if (state.emergencyContacts.some(contact => sanitizePhoneNumber(contact.phone) === phone)) {
    showNotification('This phone number is already saved as an emergency contact.', 'warning', 2600);
    return;
  }
  state.emergencyContacts.push({
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
export function removeEmergencyContact(id) {
  state.emergencyContacts = state.emergencyContacts.filter(contact => contact.id !== id);
  persistEmergencyContacts();
  renderEmergencyContacts();
  showNotification('Emergency contact removed.', 'info', 1500);
}
export function callEmergencyContact(id) {
  const contact = state.emergencyContacts.find(c => c.id === id);
  if (!contact) return;
  const phone = sanitizePhoneNumber(contact.phone);
  if (!isValidPhoneNumber(phone)) {
    showNotification('This contact has an invalid phone number.', 'error', 2200);
    return;
  }
  window.location.href = `tel:${phone}`;
}
export function triggerSOSCall() {
  if (!state.emergencyContacts.length) {
    showNotification('Add at least one emergency contact first.', 'warning', 2500);
    openEmergencyContacts();
    return;
  }
  const primary = state.emergencyContacts[0];
  const phone = sanitizePhoneNumber(primary.phone);
  if (!isValidPhoneNumber(phone)) {
    showNotification('Primary contact phone number is invalid.', 'error', 2200);
    return;
  }
  showNotification(`Calling ${primary.name}...`, 'warning', 2000);
  window.location.href = `tel:${phone}`;
}

// ── Edge AI UI Logic ──────────────────────────────────────────
export async function toggleEdgeAI() {
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