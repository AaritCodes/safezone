// ============================================================
// SafeZone — Data Module (Dynamic, API-Powered)
// ============================================================

// Default center: New Delhi, India
const MAP_CENTER = [28.6139, 77.2090];
const MAP_ZOOM = 13;

// ── Real Emergency Numbers (Expanded) ─────────────────────────
const EMERGENCY_NUMBERS = {
  IN: { unified: '112', police: '100', ambulance: '102', fire: '101', women: '1091', child: '1098', country: 'India' },
  US: { unified: '911', police: '911', ambulance: '911', fire: '911', country: 'United States' },
  GB: { unified: '999', police: '999', ambulance: '999', fire: '999', country: 'United Kingdom' },
  CA: { unified: '911', police: '911', ambulance: '911', fire: '911', country: 'Canada' },
  AU: { unified: '000', police: '000', ambulance: '000', fire: '000', country: 'Australia' },
  NZ: { unified: '111', police: '111', ambulance: '111', fire: '111', country: 'New Zealand' },
  DE: { unified: '112', police: '110', ambulance: '112', fire: '112', country: 'Germany' },
  FR: { unified: '112', police: '17', ambulance: '15', fire: '18', country: 'France' },
  ES: { unified: '112', police: '112', ambulance: '112', fire: '112', country: 'Spain' },
  IT: { unified: '112', police: '112', ambulance: '118', fire: '115', country: 'Italy' },
  JP: { unified: '110/119', police: '110', ambulance: '119', fire: '119', country: 'Japan' },
  CN: { unified: '110/120', police: '110', ambulance: '120', fire: '119', country: 'China' },
  BR: { unified: '190', police: '190', ambulance: '192', fire: '193', country: 'Brazil' },
  MX: { unified: '911', police: '911', ambulance: '911', fire: '911', country: 'Mexico' },
  ZA: { unified: '10111', police: '10111', ambulance: '10177', fire: '10177', country: 'South Africa' },
  AE: { unified: '999', police: '999', ambulance: '998', fire: '997', country: 'UAE' },
  SG: { unified: '999', police: '999', ambulance: '995', fire: '995', country: 'Singapore' },
  MY: { unified: '999', police: '999', ambulance: '999', fire: '994', country: 'Malaysia' },
  TH: { unified: '191', police: '191', ambulance: '1669', fire: '199', country: 'Thailand' },
  PH: { unified: '911', police: '911', ambulance: '911', fire: '911', country: 'Philippines' },
  KR: { unified: '112', police: '112', ambulance: '119', fire: '119', country: 'South Korea' },
  RU: { unified: '112', police: '102', ambulance: '103', fire: '101', country: 'Russia' },
  TR: { unified: '112', police: '155', ambulance: '112', fire: '110', country: 'Turkey' },
  SA: { unified: '999', police: '999', ambulance: '997', fire: '998', country: 'Saudi Arabia' },
  EG: { unified: '122', police: '122', ambulance: '123', fire: '180', country: 'Egypt' },
  NG: { unified: '112', police: '112', ambulance: '112', fire: '112', country: 'Nigeria' },
  KE: { unified: '999', police: '999', ambulance: '999', fire: '999', country: 'Kenya' },
  AR: { unified: '911', police: '911', ambulance: '107', fire: '100', country: 'Argentina' },
  CL: { unified: '133', police: '133', ambulance: '131', fire: '132', country: 'Chile' },
  CO: { unified: '123', police: '123', ambulance: '125', fire: '119', country: 'Colombia' },
  PE: { unified: '105', police: '105', ambulance: '117', fire: '116', country: 'Peru' },
  DEFAULT: { unified: '112', police: '112', ambulance: '112', fire: '112', country: 'Unknown' }
};

let currentCountryCode = 'IN';

// ── Performance Cache ─────────────────────────────────────────
const heatmapCache = new Map();
const CACHE_DURATION = 300000; // 5 minutes

// ── Request Throttling ────────────────────────────────────────
let lastRequestTime = 0;
const REQUEST_DELAY = 1000; // 1 second between requests

async function throttledFetch(url, options) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < REQUEST_DELAY) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// ── Overpass API — Fetch Real Nearby Services ─────────────────
async function fetchNearbyAmenities(lat, lng, radius = 3000) {
  const query = `
    [out:json][timeout:10];
    (
      node["amenity"="police"](around:${radius},${lat},${lng});
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="fire_station"](around:${radius},${lat},${lng});
      way["amenity"="police"](around:${radius},${lat},${lng});
      way["amenity"="hospital"](around:${radius},${lat},${lng});
      way["amenity"="fire_station"](around:${radius},${lat},${lng});
    );
    out center body;
  `;

  try {
    const response = await throttledFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    return parseOverpassResults(data.elements, lat, lng);
  } catch (err) {
    console.warn('Overpass API failed, using fallback data:', err);
    return { ...generateFallbackServices(lat, lng), error: 'API_FAILED' };
  }
}

function parseOverpassResults(elements, userLat, userLng) {
  const services = { police: [], hospital: [], fire: [] };

  elements.forEach((el, i) => {
    const elLat = el.lat || (el.center && el.center.lat);
    const elLng = el.lon || (el.center && el.center.lon);
    if (!elLat || !elLng) return;

    const amenity = el.tags && el.tags.amenity;
    const name = (el.tags && (el.tags.name || el.tags['name:en'])) || `${amenity ? amenity.charAt(0).toUpperCase() + amenity.slice(1) : 'Service'} #${i + 1}`;
    const phone = (el.tags && (el.tags.phone || el.tags['contact:phone'])) || getEmergencyNumber(amenity);
    const dist = Math.round(getDistance(userLat, userLng, elLat, elLng));
    const address = (el.tags && (el.tags['addr:full'] || el.tags['addr:street'])) || '';

    const entry = {
      id: `${amenity}_${el.id}`,
      type: amenity === 'fire_station' ? 'fire' : amenity,
      name: name,
      lat: elLat,
      lng: elLng,
      phone: phone,
      address: address || `${elLat.toFixed(4)}, ${elLng.toFixed(4)}`,
      distance: dist,
      source: 'openstreetmap'
    };

    if (amenity === 'police') services.police.push(entry);
    else if (amenity === 'hospital') services.hospital.push(entry);
    else if (amenity === 'fire_station') services.fire.push(entry);
  });

  // Sort by distance
  Object.keys(services).forEach(type => {
    services[type].sort((a, b) => a.distance - b.distance);
  });

  return services;
}

function getEmergencyNumber(amenity) {
  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  if (amenity === 'police') return nums.police;
  if (amenity === 'hospital') return nums.ambulance;
  if (amenity === 'fire_station') return nums.fire;
  return nums.unified;
}

// Fallback if API fails
function generateFallbackServices(lat, lng) {
  const nums = EMERGENCY_NUMBERS[currentCountryCode] || EMERGENCY_NUMBERS.DEFAULT;
  const services = { police: [], hospital: [], fire: [] };

  // Generate 3 fake nearby police stations
  for (let i = 0; i < 3; i++) {
    const offset = (i + 1) * 0.005;
    services.police.push({
      id: `fallback_p${i}`, type: 'police',
      name: `Police Station ${i + 1}`,
      lat: lat + (Math.random() - 0.5) * offset * 2,
      lng: lng + (Math.random() - 0.5) * offset * 2,
      phone: nums.police,
      address: 'Location approximate',
      distance: Math.round(300 + i * 600 + Math.random() * 300),
      source: 'estimated'
    });
  }

  for (let i = 0; i < 3; i++) {
    const offset = (i + 1) * 0.006;
    services.hospital.push({
      id: `fallback_h${i}`, type: 'hospital',
      name: `Hospital ${i + 1}`,
      lat: lat + (Math.random() - 0.5) * offset * 2,
      lng: lng + (Math.random() - 0.5) * offset * 2,
      phone: nums.ambulance,
      address: 'Location approximate',
      distance: Math.round(400 + i * 700 + Math.random() * 400),
      source: 'estimated'
    });
  }

  for (let i = 0; i < 2; i++) {
    const offset = (i + 1) * 0.008;
    services.fire.push({
      id: `fallback_f${i}`, type: 'fire',
      name: `Fire Station ${i + 1}`,
      lat: lat + (Math.random() - 0.5) * offset * 2,
      lng: lng + (Math.random() - 0.5) * offset * 2,
      phone: nums.fire,
      address: 'Location approximate',
      distance: Math.round(500 + i * 800 + Math.random() * 500),
      source: 'estimated'
    });
  }

  return services;
}

// ── Fetch nearby CCTV / surveillance cameras from OSM ─────────
async function fetchNearbyCameras(lat, lng, radius = 2000) {
  const query = `
    [out:json][timeout:10];
    (
      node["man_made"="surveillance"](around:${radius},${lat},${lng});
      node["amenity"="cctv"](around:${radius},${lat},${lng});
    );
    out body;
  `;

  try {
    const response = await throttledFetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    const cameras = data.elements.map((el, i) => ({
      id: `cam_${el.id}`,
      lat: el.lat,
      lng: el.lon,
      name: (el.tags && el.tags.description) || `CCTV Camera #${i + 1}`,
      status: 'active',
      coverage: 100 + Math.floor(Math.random() * 100),
      resolution: ['720p', '1080p', '4K'][Math.floor(Math.random() * 3)],
      distance: Math.round(getDistance(lat, lng, el.lat, el.lon)),
      source: 'openstreetmap'
    }));
    cameras.sort((a, b) => a.distance - b.distance);
    return cameras;
  } catch (err) {
    console.warn('Camera fetch failed, generating estimates:', err);
    const fallback = generateFallbackCameras(lat, lng);
    return { cameras: fallback, error: 'API_FAILED' };
  }
}

function generateFallbackCameras(lat, lng) {
  const cameras = [];
  const count = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    cameras.push({
      id: `fallback_cam_${i}`,
      lat: lat + (Math.random() - 0.5) * 0.015,
      lng: lng + (Math.random() - 0.5) * 0.015,
      name: `Surveillance Camera #${i + 1}`,
      status: Math.random() > 0.2 ? 'active' : 'maintenance',
      coverage: 80 + Math.floor(Math.random() * 120),
      resolution: ['720p', '1080p', '4K'][Math.floor(Math.random() * 3)],
      distance: Math.round(200 + i * 300 + Math.random() * 200),
      source: 'estimated'
    });
  }
  return cameras;
}

// ── Reverse Geocoding (get area name) ─────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const response = await throttledFetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();

    // Detect country code for emergency numbers
    if (data.address && data.address.country_code) {
      currentCountryCode = data.address.country_code.toUpperCase();
    }

    return {
      name: data.address
        ? (data.address.neighbourhood || data.address.suburb || data.address.city_district || data.address.town || data.address.city || data.display_name.split(',')[0])
        : 'Unknown Area',
      fullAddress: data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: data.address
        ? (data.address.city || data.address.town || data.address.state || '')
        : '',
      type: data.type || 'unknown',
      category: data.class || 'unknown',
      countryCode: currentCountryCode
    };
  } catch (err) {
    console.warn('Reverse geocode failed:', err);
    return { 
      name: 'Unknown Area', 
      fullAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, 
      area: '', 
      type: 'unknown', 
      category: 'unknown', 
      countryCode: 'IN',
      error: 'API_FAILED'
    };
  }
}

// ── Dynamic Safety Score Algorithm (Enhanced) ─────────────────
function calculateSafetyScore(hour, services, cameras, areaInfo) {
  let score = 50; // Base score
  let factors = []; // Track what influenced the score

  // Factor 1: Number of nearby police stations (max +20)
  const policeCount = services.police.length;
  const policeBonus = Math.min(20, policeCount * 6);
  score += policeBonus;
  if (policeBonus > 0) factors.push(`+${policeBonus} (${policeCount} police station${policeCount > 1 ? 's' : ''})`);

  // Factor 2: Distance to closest police (max +15)
  if (services.police.length > 0) {
    const closestPolice = services.police[0].distance;
    let distBonus = 0;
    if (closestPolice < 500) distBonus = 15;
    else if (closestPolice < 1000) distBonus = 10;
    else if (closestPolice < 2000) distBonus = 5;
    else distBonus = 2;
    score += distBonus;
    factors.push(`+${distBonus} (police ${closestPolice}m away)`);
  } else {
    score -= 10;
    factors.push('-10 (no police nearby)');
  }

  // Factor 3: Hospital access (max +12)
  if (services.hospital.length > 0) {
    const closestHospital = services.hospital[0].distance;
    let hospBonus = 0;
    if (closestHospital < 500) hospBonus = 12;
    else if (closestHospital < 1000) hospBonus = 8;
    else if (closestHospital < 2000) hospBonus = 5;
    else hospBonus = 2;
    score += hospBonus;
    factors.push(`+${hospBonus} (hospital ${closestHospital}m away)`);
  } else {
    score -= 5;
    factors.push('-5 (no hospital nearby)');
  }

  // Factor 4: Fire station access (max +8)
  if (services.fire.length > 0) {
    const fireBonus = Math.min(8, services.fire.length * 3 + 2);
    score += fireBonus;
    factors.push(`+${fireBonus} (${services.fire.length} fire station${services.fire.length > 1 ? 's' : ''})`);
  }

  // Factor 5: CCTV coverage (max +15)
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);
  const activeCount = cameraArray.filter(c => c.status === 'active').length;
  let camBonus = 0;
  if (activeCount >= 5) camBonus = 15;
  else if (activeCount >= 3) camBonus = 10;
  else if (activeCount >= 1) camBonus = 5;
  
  if (camBonus > 0) {
    score += camBonus;
    factors.push(`+${camBonus} (${activeCount} active camera${activeCount > 1 ? 's' : ''})`);
  } else {
    score -= 8;
    factors.push('-8 (no surveillance)');
  }

  // Factor 6: Time of day (major factor, -30 to +10)
  let timeBonus = 0;
  let timeDesc = '';
  if (hour >= 6 && hour <= 8) {
    timeBonus = 5;
    timeDesc = 'early morning';
  } else if (hour >= 9 && hour <= 17) {
    timeBonus = 10;
    timeDesc = 'daytime';
  } else if (hour >= 18 && hour <= 20) {
    timeBonus = -5;
    timeDesc = 'evening';
  } else if (hour >= 21 && hour <= 22) {
    timeBonus = -12;
    timeDesc = 'late evening';
  } else if (hour === 23 || hour <= 1) {
    timeBonus = -22;
    timeDesc = 'night';
  } else if (hour >= 2 && hour <= 4) {
    timeBonus = -30;
    timeDesc = 'deep night';
  } else if (hour === 5) {
    timeBonus = -15;
    timeDesc = 'pre-dawn';
  }
  score += timeBonus;
  factors.push(`${timeBonus >= 0 ? '+' : ''}${timeBonus} (${timeDesc})`);

  // Factor 7: Area type bonus (max +8)
  const areaType = (areaInfo.type + ' ' + areaInfo.category).toLowerCase();
  let areaBonus = 0;
  let areaDesc = '';
  
  if (areaType.includes('residential')) {
    areaBonus = 5;
    areaDesc = 'residential area';
  } else if (areaType.includes('commercial')) {
    areaBonus = 4;
    areaDesc = 'commercial area';
  } else if (areaType.includes('industrial')) {
    areaBonus = -5;
    areaDesc = 'industrial area';
  } else if (areaType.includes('park') || areaType.includes('garden')) {
    if (hour >= 6 && hour <= 18) {
      areaBonus = 8;
      areaDesc = 'park (daytime)';
    } else {
      areaBonus = -12;
      areaDesc = 'park (nighttime)';
    }
  }
  
  if (areaBonus !== 0) {
    score += areaBonus;
    factors.push(`${areaBonus >= 0 ? '+' : ''}${areaBonus} (${areaDesc})`);
  }

  // Factor 8: Population density estimate (based on service density)
  const totalServices = policeCount + services.hospital.length + services.fire.length;
  if (totalServices >= 8) {
    score += 5;
    factors.push('+5 (high service density)');
  } else if (totalServices <= 2) {
    score -= 5;
    factors.push('-5 (low service density)');
  }

  // Factor 9: Edge AI Local Anomaly (Microphone / Accelerometer)
  if (typeof EdgeAI !== 'undefined' && EdgeAI.isActive()) {
    const edgeAnomaly = EdgeAI.getAnomalyScore();
    if (edgeAnomaly > 0) {
      score -= edgeAnomaly;
      factors.push(`-${edgeAnomaly} (Edge AI Guardian: Local Anomaly Detected)`);
    } else {
      score += 5;
      factors.push(`+5 (Edge AI Guardian Active)`);
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, factors };
}

// Generate risk factors based on the computed data
function generateRiskFactors(hour, services, cameras, areaInfo) {
  const risks = [];
  const features = [];
  
  const cameraArray = Array.isArray(cameras) ? cameras : (cameras.cameras || []);

  // Time-based risks
  if (hour >= 22 || hour <= 4) {
    risks.push('Late night / early morning hours');
    risks.push('Reduced visibility');
    risks.push('Lower pedestrian activity');
  } else if (hour >= 18 && hour < 22) {
    risks.push('Evening hours — decreasing visibility');
  }

  // Service proximity risks
  if (services.police.length === 0) {
    risks.push('No police stations detected nearby');
  } else if (services.police[0].distance > 2000) {
    risks.push('Nearest police station is over 2 km away');
  } else {
    features.push(`Police station within ${services.police[0].distance}m`);
  }

  if (services.hospital.length === 0) {
    risks.push('No hospitals detected nearby');
  } else if (services.hospital[0].distance > 3000) {
    risks.push('Nearest hospital is over 3 km away');
  } else {
    features.push(`Hospital within ${services.hospital[0].distance}m`);
  }

  if (services.fire.length === 0) {
    risks.push('No fire stations detected nearby');
  } else {
    features.push(`Fire station within ${services.fire[0].distance}m`);
  }

  // Camera coverage
  const activeCount = cameraArray.filter(c => c.status === 'active').length;
  if (activeCount === 0) {
    risks.push('No active surveillance cameras detected');
  } else if (activeCount < 3) {
    risks.push('Limited CCTV coverage');
    features.push(`${activeCount} active camera(s) nearby`);
  } else {
    features.push(`${activeCount} active surveillance cameras`);
  }

  // Ensure minimum entries
  if (features.length === 0) features.push('General urban area');
  if (risks.length === 0) risks.push('No major risks identified');

  // Daytime features
  if (hour >= 7 && hour <= 19) {
    features.push('Daylight hours — good visibility');
    features.push('Higher pedestrian activity');
  }

  return { risks, features };
}

// ── Heatmap Data Points (with caching) ───────────────────────
function getHeatmapData(hour, center = MAP_CENTER, span = 0.05) {
  const cacheKey = `${center[0].toFixed(3)}_${center[1].toFixed(3)}_${hour}`;
  
  // Check cache
  const cached = heatmapCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  const points = [];
  const nightMultiplier = (hour >= 22 || hour <= 4) ? 1.8 : (hour >= 18 || hour <= 6) ? 1.3 : 0.5;

  // Generate random danger spots around the current map view
  const numHotspots = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < numHotspots; i++) {
    const lat = center[0] + (Math.random() - 0.5) * span * 2;
    const lng = center[1] + (Math.random() - 0.5) * span * 2;
    const baseIntensity = 0.3 + Math.random() * 0.6;
    const intensity = Math.min(1, baseIntensity * nightMultiplier);
    points.push([lat, lng, intensity]);

    for (let j = 0; j < 6; j++) {
      points.push([
        lat + (Math.random() - 0.5) * 0.008,
        lng + (Math.random() - 0.5) * 0.008,
        intensity * (0.3 + Math.random() * 0.4)
      ]);
    }
  }

  // Ambient risk
  for (let i = 0; i < 25; i++) {
    points.push([
      center[0] + (Math.random() - 0.5) * span * 2.5,
      center[1] + (Math.random() - 0.5) * span * 2.5,
      (0.03 + Math.random() * 0.12) * nightMultiplier
    ]);
  }
  
  // Cache the result
  heatmapCache.set(cacheKey, { data: points, timestamp: Date.now() });
  
  // Clean old cache entries
  if (heatmapCache.size > 50) {
    const oldestKey = heatmapCache.keys().next().value;
    heatmapCache.delete(oldestKey);
  }

  return points;
}

// ── Mock Broker API (Real Estate Integration) ───────────────────
async function fetchNearbyProperties(lat, lng, radius = 2000) {
  // Simulate network delay for authenticity
  await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
  
  const properties = [];
  const numProps = 5 + Math.floor(Math.random() * 6); // 5 to 10 properties

  const propertyTypes = ['House', 'Apartment', 'Condo', 'Townhouse'];
  const listingTypes = ['For Sale', 'For Rent'];
  
  for (let i = 0; i < numProps; i++) {
    const listType = listingTypes[Math.floor(Math.random() * listingTypes.length)];
    const propType = propertyTypes[Math.floor(Math.random() * propertyTypes.length)];
    const beds = 1 + Math.floor(Math.random() * 4);
    const baths = 1 + Math.floor(Math.random() * 3);
    
    let price;
    if (listType === 'For Sale') {
      price = 150000 + Math.floor(Math.random() * 850000);
      price = `$${price.toLocaleString()}`;
    } else {
      price = 900 + Math.floor(Math.random() * 3000);
      price = `$${price.toLocaleString()}/mo`;
    }

    properties.push({
      id: `prop_${Math.random().toString(36).substr(2, 9)}`,
      lat: lat + (Math.random() - 0.5) * (radius / 55000), // Approximate offset
      lng: lng + (Math.random() - 0.5) * (radius / 55000),
      title: `${beds} Bed ${propType} ${listType}`,
      price: price,
      beds: beds,
      baths: baths,
      sqft: 600 + Math.floor(Math.random() * 2000),
      type: listType,
      distance: Math.round(Math.random() * radius),
      image: `https://images.unsplash.com/photo-${[
        '1512917774080-9991f1c4c750', '1600596542815-ffad4c1539a9', '1564013799919-ab600027ffc6',
        '1522708323590-d24dbb6b0267', '1580587771525-78b9dba3b914', '1449844908441-8829872d2607'
      ][Math.floor(Math.random() * 6)]}?auto=format&fit=crop&w=300&q=80`
    });
  }
  
  // Sort by distance roughly
  properties.sort((a, b) => a.distance - b.distance);
  return properties;
}

// ── Utility Functions ─────────────────────────────────────────
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSafetyLevel(score) {
  if (score >= 80) return { label: 'Very Safe', class: 'very-safe', icon: '🟢' };
  if (score >= 60) return { label: 'Moderately Safe', class: 'moderate', icon: '🟡' };
  if (score >= 40) return { label: 'Use Caution', class: 'caution', icon: '🟠' };
  return { label: 'High Risk', class: 'danger', icon: '🔴' };
}

function formatTime(hour) {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
