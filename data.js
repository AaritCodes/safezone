// ============================================================
// SafeZone — Data Module (Dynamic, API-Powered)
// ============================================================

// Default center: New Delhi, India
const MAP_CENTER = [28.6139, 77.2090];
const MAP_ZOOM = 13;
const GOOGLE_API_KEY = 'AIzaSyCYFwU8dtaM2mj0l-_Q1EGgpV2Ab_LjRz4';
const GOOGLE_API_KEY_META_NAME = 'safezone-google-api-key';

function readGoogleApiKeyFromMetaTag() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return '';
  }

  const meta = document.querySelector(`meta[name="${GOOGLE_API_KEY_META_NAME}"]`);
  if (!meta) return '';

  const content = String(meta.getAttribute('content') || '').trim();
  if (!content) return '';

  if (/^your[_\s-]?google[_\s-]?api[_\s-]?key$/i.test(content)) {
    return '';
  }

  return content;
}

function getGoogleApiKey() {
  if (typeof window !== 'undefined' && typeof window.SAFEZONE_GOOGLE_API_KEY === 'string' && window.SAFEZONE_GOOGLE_API_KEY.trim()) {
    return window.SAFEZONE_GOOGLE_API_KEY.trim();
  }

  const metaKey = readGoogleApiKeyFromMetaTag();
  if (metaKey) return metaKey;

  return GOOGLE_API_KEY;
}

function hasGoogleApiKey() {
  const key = getGoogleApiKey();
  return Boolean(key && key.length > 20);
}

let googleMapsLoaded = false;
let googleMapsLoadingPromise = null;

async function ensureGoogleMapsLoaded() {
  if (typeof google !== 'undefined' && google && google.maps) return true;
  if (!hasGoogleApiKey()) return false;
  if (googleMapsLoadingPromise) return googleMapsLoadingPromise;

  const key = getGoogleApiKey();
  googleMapsLoadingPromise = new Promise((resolve) => {
    const callbackName = 'initGoogleMapsSDK' + Date.now();
    let isTimeout = false;

    const timeoutId = setTimeout(() => {
      isTimeout = true;
      console.warn('Google Maps SDK load timed out.');
      resolve(false);
    }, 8000);

    window[callbackName] = () => {
      if (isTimeout) return;
      clearTimeout(timeoutId);
      googleMapsLoaded = true;
      resolve(true);
      delete window[callbackName];
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      if (isTimeout) return;
      clearTimeout(timeoutId);
      console.warn('Failed to load Google Maps SDK script.');
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return googleMapsLoadingPromise;
}

function getGoogleErrorCode(details = {}) {
  if (details.code) return details.code;

  const googleStatus = String(details.googleStatus || '').toUpperCase();
  const httpStatus = Number(details.httpStatus || 0);

  if (googleStatus === 'OVER_QUERY_LIMIT') return 'GOOGLE_RATE_LIMITED';
  if (googleStatus === 'OVER_DAILY_LIMIT') return 'GOOGLE_RATE_LIMITED';
  if (googleStatus === 'REQUEST_DENIED') return 'GOOGLE_FORBIDDEN';
  if (googleStatus === 'INVALID_REQUEST') return 'GOOGLE_INVALID_REQUEST';
  if (googleStatus === 'UNKNOWN_ERROR') return 'GOOGLE_SERVICE_UNAVAILABLE';

  if (httpStatus === 401) return 'GOOGLE_UNAUTHORIZED';
  if (httpStatus === 403) return 'GOOGLE_FORBIDDEN';
  if (httpStatus === 429) return 'GOOGLE_RATE_LIMITED';
  if (httpStatus >= 500) return 'GOOGLE_SERVICE_UNAVAILABLE';

  return 'GOOGLE_REQUEST_FAILED';
}

function getGoogleErrorMessage(code, context, details = {}) {
  let message = 'Google API request failed.';

  if (code === 'GOOGLE_UNAUTHORIZED') {
    message = 'Google API key was rejected (401 unauthorized).';
  } else if (code === 'GOOGLE_FORBIDDEN') {
    message = 'Google API request was denied (403 forbidden).';
  } else if (code === 'GOOGLE_RATE_LIMITED') {
    message = 'Google API quota was exceeded or rate limited.';
  } else if (code === 'GOOGLE_TIMEOUT') {
    message = 'Google API request timed out.';
  } else if (code === 'GOOGLE_NETWORK') {
    message = 'Google API request failed due to network connectivity.';
  } else if (code === 'GOOGLE_INVALID_REQUEST') {
    message = 'Google API request parameters were invalid.';
  } else if (code === 'GOOGLE_SERVICE_UNAVAILABLE') {
    message = 'Google API service is temporarily unavailable.';
  }

  const scope = context ? ` (${context})` : '';
  const googleMessage = String(details.googleMessage || '').trim();
  if (googleMessage) {
    return `${message}${scope}: ${googleMessage}`;
  }

  return `${message}${scope}`;
}

function createGoogleApiError(context, details = {}) {
  const code = getGoogleErrorCode(details);
  const error = new Error(getGoogleErrorMessage(code, context, details));
  error.name = 'GoogleApiError';
  error.code = code;
  error.context = context;

  if (details.httpStatus) error.httpStatus = Number(details.httpStatus);
  if (details.googleStatus) error.googleStatus = String(details.googleStatus);
  if (details.googleMessage) error.googleMessage = String(details.googleMessage);
  if (details.cause) error.cause = details.cause;

  return error;
}

async function parseGoogleJsonResponse(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function fetchGoogleJson(url, options = {}, timeoutMs = 9000, context = 'request') {
  let response;

  try {
    response = await fetchWithTimeout(url, options, timeoutMs);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw createGoogleApiError(context, { code: 'GOOGLE_TIMEOUT', cause: err });
    }

    throw createGoogleApiError(context, { code: 'GOOGLE_NETWORK', cause: err });
  }

  const data = await parseGoogleJsonResponse(response);

  if (!response.ok) {
    throw createGoogleApiError(context, {
      httpStatus: response.status,
      googleStatus: data && data.status
        ? data.status
        : (data && data.error && data.error.status ? data.error.status : ''),
      googleMessage: data && data.error_message
        ? data.error_message
        : (data && data.error && data.error.message ? data.error.message : '')
    });
  }

  if (data && typeof data.status === 'string') {
    if (data.status === 'ZERO_RESULTS') {
      return { data, noResults: true };
    }

    if (data.status !== 'OK') {
      throw createGoogleApiError(context, {
        googleStatus: data.status,
        googleMessage: data.error_message || ''
      });
    }
  }

  return { data: data || {}, noResults: false };
}

function notifyGoogleFallback(error, fallbackProvider) {
  if (typeof window === 'undefined' || typeof window.SafeZoneNotifyGoogleFallback !== 'function') {
    return;
  }

  try {
    window.SafeZoneNotifyGoogleFallback(error, fallbackProvider);
  } catch (notifyErr) {
    console.warn('Google fallback notifier failed:', notifyErr);
  }
}

function getCurrentRegionHint() {
  if (typeof currentCountryCode === 'string' && currentCountryCode.trim()) {
    return currentCountryCode.trim().toLowerCase();
  }
  return '';
}

function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeGooglePolyline(encoded) {
  if (!encoded) return [];

  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;

    coordinates.push([lat / 1e5, lng / 1e5]);
  }

  return coordinates;
}

async function geocodeQueryWithGoogle(query) {
  const isLoaded = await ensureGoogleMapsLoaded();
  if (!isLoaded) return null;

  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    const region = getCurrentRegionHint();
    const request = { address: query };
    if (region && /^[a-z]{2}$/i.test(region)) {
      request.region = region;
    }

    geocoder.geocode(request, (results, status) => {
      if (status !== 'OK' || !results || results.length === 0) {
        return resolve(null);
      }

      const best = results[0];
      const location = best.geometry && best.geometry.location ? best.geometry.location : null;
      if (!location) return resolve(null);

      const label = String(best.formatted_address || query).split(',')[0].trim();
      const addressComponents = Array.isArray(best.address_components) ? best.address_components : [];
      const countryComponent = addressComponents.find(component => Array.isArray(component.types) && component.types.includes('country'));
      if (countryComponent && countryComponent.short_name) {
        currentCountryCode = String(countryComponent.short_name).toUpperCase();
      }

      resolve({
        lat: location.lat(),
        lng: location.lng(),
        label,
        fullLabel: String(best.formatted_address || query),
        source: 'google-geocode-sdk'
      });
    });
  });
}

async function reverseGeocodeWithGoogle(lat, lng) {
  const isLoaded = await ensureGoogleMapsLoaded();
  if (!isLoaded) return null;

  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status !== 'OK' || !results || results.length === 0) {
        return resolve(null);
      }

      const best = results[0];
      const addressComponents = Array.isArray(best.address_components) ? best.address_components : [];
      const getComponent = (types) => {
        const match = addressComponents.find(component => Array.isArray(component.types) && types.some(type => component.types.includes(type)));
        return match ? match.long_name : '';
      };

      const countryShort = (() => {
        const match = addressComponents.find(component => Array.isArray(component.types) && component.types.includes('country'));
        return match && match.short_name ? String(match.short_name).toUpperCase() : '';
      })();

      if (countryShort) {
        currentCountryCode = countryShort;
      }

      const locality = getComponent(['neighborhood', 'sublocality', 'locality', 'administrative_area_level_2']);
      const area = getComponent(['locality', 'administrative_area_level_2', 'administrative_area_level_1']);

      resolve({
        name: locality || String(best.formatted_address || 'Selected location').split(',')[0],
        fullAddress: String(best.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
        area: area || locality || '',
        type: 'google-place',
        category: 'geocode',
        countryCode: currentCountryCode,
        source: 'google-geocode-sdk'
      });
    });
  });
}

async function fetchApproximateLocationFromGoogle() {
  if (!hasGoogleApiKey()) return null;

  const key = getGoogleApiKey();
  const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(key)}`;
  const { data } = await fetchGoogleJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ considerIp: true })
    },
    9000,
    'geolocation'
  );

  const location = data && data.location ? data.location : null;
  const lat = location ? Number(location.lat) : NaN;
  const lng = location ? Number(location.lng) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    accuracy: Number(data.accuracy || 0),
    source: 'google-geolocation'
  };
}

async function fetchRouteDirectionsWithGoogle(fromLat, fromLng, toLat, toLng, profile = 'driving') {
  const isLoaded = await ensureGoogleMapsLoaded();
  if (!isLoaded) return null;

  return new Promise((resolve) => {
    const directionsService = new google.maps.DirectionsService();
    const mode = profile === 'walking' ? google.maps.TravelMode.WALKING : google.maps.TravelMode.DRIVING;

    directionsService.route({
      origin: new google.maps.LatLng(fromLat, fromLng),
      destination: new google.maps.LatLng(toLat, toLng),
      travelMode: mode,
      provideRouteAlternatives: true
    }, (response, status) => {
      if (status !== 'OK' || !response || !response.routes || response.routes.length === 0) {
        return resolve(null);
      }

      const routes = response.routes
        .slice(0, 3)
        .map((route, index) => mapGoogleDirectionsRouteCandidate(route, fromLat, fromLng, index))
        .filter(route => Array.isArray(route.path) && route.path.length > 1);

      if (!routes.length) {
        return resolve(null);
      }

      resolve({
        source: 'google-directions-sdk',
        alternatives: routes
      });
    });
  });
}

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
const REQUEST_DEFAULT_DELAY_MS = 50;
const REQUEST_DELAY_BY_HOST_MS = {
  'nominatim.openstreetmap.org': 200
};
const requestHostTimestamps = new Map();
const RISK_MODEL_STORAGE_KEY = 'safezoneRiskModel';
const FETCH_TIMEOUT_MS = 5000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];
const GOOGLE_PLACES_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const GOOGLE_PLACES_MAX_RADIUS = 50000;
const GOOGLE_PLACES_CALLBACK_TIMEOUT_MS = 6500;

const THEFT_CATEGORIES = new Set([
  'burglary',
  'robbery',
  'shoplifting',
  'theft-from-the-person',
  'vehicle-crime',
  'bicycle-theft'
]);

const VIOLENT_CATEGORIES = new Set([
  'violence-and-sexual-offences',
  'public-order',
  'possession-of-weapons'
]);

const RISK_SIGNAL_MAX_RADIUS_METERS = 2600;
const HOTSPOT_DEDUPLICATION_GRID_SIZE = 0.00045;

function getThrottleHostKey(url) {
  const raw = typeof url === 'string'
    ? url
    : (url && typeof url.url === 'string' ? url.url : '');

  if (!raw) return 'default';

  try {
    const base = typeof window !== 'undefined' && window.location && window.location.href
      ? window.location.href
      : 'https://safezone.local';
    const parsed = new URL(raw, base);
    return String(parsed.hostname || 'default').toLowerCase();
  } catch (err) {
    return 'default';
  }
}

function getRequestDelayMsForHost(hostKey) {
  if (REQUEST_DELAY_BY_HOST_MS[hostKey]) {
    return REQUEST_DELAY_BY_HOST_MS[hostKey];
  }
  return REQUEST_DEFAULT_DELAY_MS;
}

async function throttledFetch(url, options) {
  const hostKey = getThrottleHostKey(url);
  const delayMs = getRequestDelayMsForHost(hostKey);
  const now = Date.now();
  const lastRequestAt = requestHostTimestamps.get(hostKey) || 0;
  const elapsed = now - lastRequestAt;
  const waitMs = delayMs - elapsed;

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  requestHostTimestamps.set(hostKey, Date.now());
  return fetch(url, options);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await throttledFetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOverpassJson(query, timeoutMs = FETCH_TIMEOUT_MS) {
  const promises = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    }, timeoutMs);

    if (!response.ok) {
      throw new Error(`Overpass API returned ${response.status}`);
    }

    const data = await response.json();
    return { data, source: endpoint };
  });

  try {
    return await Promise.any(promises);
  } catch (err) {
    console.warn('All Overpass endpoints failed:', err);
    throw new Error('All Overpass endpoints failed');
  }
}

function normalizeGooglePlacesRadius(radius, fallbackRadius = 3000) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackRadius;
  return Math.max(100, Math.min(GOOGLE_PLACES_MAX_RADIUS, Math.round(parsed)));
}

async function fetchGoogleNearbyPlaces(lat, lng, radius, options = {}) {
  const isLoaded = await ensureGoogleMapsLoaded();
  if (!isLoaded) return [];

  return new Promise((resolve) => {
    const dummyDiv = document.createElement('div');
    const service = new google.maps.places.PlacesService(dummyDiv);
    
    const request = {
      location: new google.maps.LatLng(lat, lng),
      radius: normalizeGooglePlacesRadius(radius, 3000)
    };

    if (options.type) {
      request.type = [String(options.type)];
    }

    if (options.keyword) {
      request.keyword = String(options.keyword);
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(Array.isArray(value) ? value : []);
      dummyDiv.remove();
    };

    const timeoutId = setTimeout(() => {
      console.warn(`Google Places lookup timed out after ${GOOGLE_PLACES_CALLBACK_TIMEOUT_MS}ms`);
      finish([]);
    }, GOOGLE_PLACES_CALLBACK_TIMEOUT_MS);

    try {
      service.nearbySearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(results)) {
          finish(results);
        } else {
          finish([]);
        }
      });
    } catch (err) {
      console.warn('Google Places nearby search threw an error:', err);
      finish([]);
    }
  });
}

function mapGoogleAmenityResults(results, amenityType, userLat, userLng) {
  const mapped = [];

  (results || []).forEach((place, i) => {
    const location = place && place.geometry ? place.geometry.location : null;
    let lat = NaN;
    let lng = NaN;
    if (location) {
      lat = typeof location.lat === 'function' ? location.lat() : Number(location.lat);
      lng = typeof location.lng === 'function' ? location.lng() : Number(location.lng);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const serviceType = amenityType === 'fire_station' ? 'fire' : amenityType;
    mapped.push({
      id: `google_${amenityType}_${place.place_id || i}`,
      type: serviceType,
      name: String(place.name || `${serviceType} service`).trim(),
      lat,
      lng,
      phone: getEmergencyNumber(amenityType),
      address: String(place.vicinity || place.formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`),
      distance: Math.round(getDistance(userLat, userLng, lat, lng)),
      source: 'google-places'
    });
  });

  mapped.sort((a, b) => a.distance - b.distance);
  return mapped;
}

function dedupeGooglePlacesResults(results) {
  const deduped = [];
  const seen = new Set();

  (results || []).forEach((place) => {
    const location = place && place.geometry ? place.geometry.location : null;
    const lat = location ? (typeof location.lat === 'function' ? location.lat() : location.lat) : '';
    const lng = location ? (typeof location.lng === 'function' ? location.lng() : location.lng) : '';
    const key = String(
      place && place.place_id
        ? place.place_id
        : `${place && place.name ? place.name : ''}:${lat}:${lng}`
    );

    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(place);
  });

  return deduped;
}

function mapGoogleCameraResults(results, userLat, userLng) {
  const cameras = [];

  (results || []).forEach((place, i) => {
    const location = place && place.geometry ? place.geometry.location : null;
    const lat = location
      ? (typeof location.lat === 'function' ? Number(location.lat()) : Number(location.lat))
      : NaN;
    const lng = location
      ? (typeof location.lng === 'function' ? Number(location.lng()) : Number(location.lng))
      : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const businessStatus = String(place.business_status || '').toUpperCase();
    const status = businessStatus === 'CLOSED_TEMPORARILY' || businessStatus === 'CLOSED_PERMANENTLY'
      ? 'maintenance'
      : 'active';

    cameras.push({
      id: `google_cam_${place.place_id || i}`,
      lat,
      lng,
      name: String(place.name || `CCTV-relevant place #${i + 1}`),
      status,
      coverage: 110 + Math.floor(Math.random() * 70),
      resolution: 'Unknown',
      distance: Math.round(getDistance(userLat, userLng, lat, lng)),
      source: 'google-places'
    });
  });

  cameras.sort((a, b) => a.distance - b.distance);
  return cameras;
}

async function fetchNearbyAmenitiesWithGoogle(lat, lng, radius = 3000) {
  const services = { police: [], hospital: [], fire: [] };
  const lookups = [
    { amenityType: 'police', googleType: 'police' },
    { amenityType: 'hospital', googleType: 'hospital' },
    { amenityType: 'fire_station', googleType: 'fire_station' }
  ];

  const lookupResults = await Promise.all(
    lookups.map(async (lookup) => {
      const places = await fetchGoogleNearbyPlaces(lat, lng, radius, {
        type: lookup.googleType,
        context: `places-${lookup.amenityType}`
      });

      return { lookup, places };
    })
  );

  lookupResults.forEach(({ lookup, places }) => {
    const mapped = mapGoogleAmenityResults(places, lookup.amenityType, lat, lng);

    if (lookup.amenityType === 'police') services.police = mapped;
    else if (lookup.amenityType === 'hospital') services.hospital = mapped;
    else services.fire = mapped;
  });

  return services;
}

async function fetchNearbyCamerasWithGoogle(lat, lng, radius = 2000) {
  const keywords = ['cctv', 'surveillance'];
  const rawResults = [];

  const keywordResults = await Promise.all(
    keywords.map((keyword) => fetchGoogleNearbyPlaces(lat, lng, radius, {
      keyword,
      context: `places-cameras-${keyword}`
    }))
  );

  keywordResults.forEach((places) => {
    rawResults.push(...places);
  });

  const dedupedPlaces = dedupeGooglePlacesResults(rawResults);
  return mapGoogleCameraResults(dedupedPlaces, lat, lng);
}

// ── Nearby Services (Google Places preferred, Overpass fallback) ────────────
async function fetchNearbyAmenities(lat, lng, radius = 3000) {
  if (hasGoogleApiKey()) {
    try {
      const googleServices = await fetchNearbyAmenitiesWithGoogle(lat, lng, radius);
      const totalGoogleResults =
        googleServices.police.length +
        googleServices.hospital.length +
        googleServices.fire.length;

      if (totalGoogleResults > 0) {
        return googleServices;
      }
    } catch (err) {
      console.warn('Google Places amenities failed, falling back to Overpass:', err);
      notifyGoogleFallback(err, 'Overpass amenities feed');
    }
  }

  const query = `
    [out:json][timeout:5];
    (
      node["amenity"="police"](around:${radius},${lat},${lng});
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="fire_station"](around:${radius},${lat},${lng});
    );
    out body;
  `;

  try {
    const { data } = await fetchOverpassJson(query);
    return parseOverpassResults(data.elements, lat, lng);
  } catch (err) {
    console.warn('Overpass amenities failed, using fallback data:', err);
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

// ── Nearby Surveillance Signals (Strictly Overpass API) ──────────────────────
async function fetchNearbyCameras(lat, lng, radius = 2000) {

  const query = `
    [out:json][timeout:5];
    (
      node["man_made"="surveillance"](around:${radius},${lat},${lng});
      node["amenity"="cctv"](around:${radius},${lat},${lng});
    );
    out body;
  `;

  try {
    const { data } = await fetchOverpassJson(query);
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
    console.warn('Camera feeds failed, generating estimates:', err);
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
  if (hasGoogleApiKey()) {
    try {
      const googleResult = await reverseGeocodeWithGoogle(lat, lng);
      if (googleResult) {
        return googleResult;
      }
    } catch (err) {
      console.warn('Google reverse geocode failed, falling back to OSM:', err);
      notifyGoogleFallback(err, 'OpenStreetMap reverse geocoding');
    }
  }

  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } },
      8000
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

// ── Public Safety Intelligence (Crime + Accident Signals) ────
function isLikelyUK(lat, lng) {
  return lat >= 49 && lat <= 61 && lng >= -9 && lng <= 3;
}

function pseudoRandomFromCoords(lat, lng, salt = 0) {
  const n = Math.sin((lat * 12.9898) + (lng * 78.233) + salt) * 43758.5453;
  return n - Math.floor(n);
}

function clampRiskValue(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function extractElementCoordinates(element) {
  const lat = Number(element && (typeof element.lat !== 'undefined' ? element.lat : (element.center && element.center.lat)));
  const lng = Number(element && (typeof element.lon !== 'undefined' ? element.lon : (element.center && element.center.lon)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function getDistanceDecayWeight(distanceMeters, nearRadius = 180, farRadius = RISK_SIGNAL_MAX_RADIUS_METERS) {
  if (!Number.isFinite(distanceMeters)) return 0.25;
  if (distanceMeters <= nearRadius) return 1;
  if (distanceMeters >= farRadius) return 0.14;

  const ratio = (distanceMeters - nearRadius) / Math.max(1, farRadius - nearRadius);
  return 1 - ratio * 0.86;
}

function normalizeAndRankHotspots(hotspots, centerLat, centerLng, limit = 40) {
  const deduped = new Map();

  (hotspots || []).forEach((hotspot) => {
    const lat = Number(hotspot && hotspot.lat);
    const lng = Number(hotspot && hotspot.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const severity = Number.isFinite(hotspot.severity) ? Number(hotspot.severity) : 1;
    const distance = getDistance(centerLat, centerLng, lat, lng);
    const gridLat = Math.round(lat / HOTSPOT_DEDUPLICATION_GRID_SIZE);
    const gridLng = Math.round(lng / HOTSPOT_DEDUPLICATION_GRID_SIZE);
    const key = `${gridLat}:${gridLng}:${String(hotspot.type || 'risk')}`;
    const existing = deduped.get(key);

    if (!existing || severity > existing.severity) {
      deduped.set(key, {
        ...hotspot,
        lat,
        lng,
        severity,
        distance: Math.round(distance)
      });
    }
  });

  return Array.from(deduped.values())
    .sort((a, b) => {
      if (Math.abs(Number(b.severity || 0) - Number(a.severity || 0)) > 0.05) {
        return Number(b.severity || 0) - Number(a.severity || 0);
      }
      return Number(a.distance || Infinity) - Number(b.distance || Infinity);
    })
    .slice(0, limit)
    .map((hotspot) => ({
      lat: hotspot.lat,
      lng: hotspot.lng,
      title: hotspot.title,
      type: hotspot.type,
      source: hotspot.source
    }));
}

function getCrimeRecencyWeight(monthText) {
  const month = String(monthText || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return 0.78;

  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return 0.78;
  }

  const now = new Date();
  const ageMonths = Math.max(0, (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - monthIndex));
  return clampRiskValue(1 - ageMonths * 0.08, 0.52, 1);
}

function getCrimeSignalReliability(crimeData) {
  if (!crimeData || crimeData.error) return 0.12;

  const total = Math.max(0, Number(crimeData.total || 0));
  const coverage = clampRiskValue(Number(crimeData.coverage || 0), 0, 1);

  if (crimeData.source === 'uk-police-data') {
    const scale = clampRiskValue(total / 70, 0.18, 1);
    return clampRiskValue(0.72 + scale * 0.22, 0.72, 0.96);
  }

  if (crimeData.source === 'osm-civic-risk-proxy') {
    return clampRiskValue(0.42 + coverage * 0.36, 0.42, 0.78);
  }

  if (crimeData.source === 'model-derived-risk-proxy') {
    return 0.28;
  }

  return 0.35;
}

function getAccidentSignalReliability(accidentData) {
  if (!accidentData || accidentData.error) return 0.12;

  const sampleCount = Math.max(0, Number(accidentData.hazardCount || 0) + Number(accidentData.signalCount || 0));
  const coverage = clampRiskValue(Number(accidentData.coverage || 0), 0, 1);
  const sampleScale = clampRiskValue(sampleCount / 40, 0.1, 1);

  if (accidentData.source === 'osm-road-signals') {
    return clampRiskValue(0.46 + sampleScale * 0.24 + coverage * 0.12, 0.46, 0.82);
  }

  return 0.3;
}

function getRiskConfidenceLabel(combinedReliability, crimeData) {
  const reliability = clampRiskValue(combinedReliability, 0, 1);
  const hasDirectCrimeFeed = Boolean(crimeData && crimeData.source === 'uk-police-data' && !crimeData.error);

  if (hasDirectCrimeFeed && reliability >= 0.74) return 'high';
  if (reliability >= 0.68) return 'high';
  if (reliability >= 0.42) return 'medium';
  return 'low';
}

function buildRegionalCrimeProxySignals(elements, lat, lng) {
  const nightlifeAmenities = new Set(['bar', 'pub', 'nightclub']);
  const transitAmenities = new Set(['bus_station', 'taxi']);
  const commerceAmenities = new Set(['marketplace']);

  let nightlife = 0;
  let liquorShops = 0;
  let atms = 0;
  let parking = 0;
  let transit = 0;
  let police = 0;
  let surveillance = 0;
  let streetLights = 0;
  let theftPressure = 0;
  let violentPressure = 0;
  let protectionPressure = 0;
  const hotspots = [];

  (elements || []).forEach((el) => {
    const coords = extractElementCoordinates(el);
    if (!coords) return;

    const distance = getDistance(lat, lng, coords.lat, coords.lng);
    if (!Number.isFinite(distance) || distance > RISK_SIGNAL_MAX_RADIUS_METERS) return;

    const distanceWeight = getDistanceDecayWeight(distance);
    const tags = el.tags || {};
    const amenity = String(tags.amenity || '').toLowerCase();
    const shop = String(tags.shop || '').toLowerCase();
    const manMade = String(tags.man_made || '').toLowerCase();
    const highway = String(tags.highway || '').toLowerCase();
    const railway = String(tags.railway || '').toLowerCase();

    if (nightlifeAmenities.has(amenity)) {
      nightlife += 1;
      violentPressure += 2.2 * distanceWeight;
      theftPressure += 0.45 * distanceWeight;
      hotspots.push({
        lat: coords.lat,
        lng: coords.lng,
        title: tags.name || amenity,
        type: 'violent',
        source: 'OSM Civic Proxy',
        severity: 1.4 + distanceWeight * 1.8
      });
      return;
    }

    if (shop === 'alcohol') {
      liquorShops += 1;
      theftPressure += 1.85 * distanceWeight;
      violentPressure += 0.4 * distanceWeight;
      hotspots.push({
        lat: coords.lat,
        lng: coords.lng,
        title: tags.name || 'alcohol shop',
        type: 'theft',
        source: 'OSM Civic Proxy',
        severity: 1.2 + distanceWeight * 1.45
      });
      return;
    }

    if (amenity === 'atm' || amenity === 'bank') {
      atms += 1;
      theftPressure += 1.45 * distanceWeight;
      hotspots.push({
        lat: coords.lat,
        lng: coords.lng,
        title: tags.name || amenity,
        type: 'theft',
        source: 'OSM Civic Proxy',
        severity: 1.1 + distanceWeight * 1.25
      });
      return;
    }

    if (amenity === 'parking' || tags.parking || amenity === 'parking_entrance') {
      parking += 1;
      theftPressure += 1.08 * distanceWeight;
      hotspots.push({
        lat: coords.lat,
        lng: coords.lng,
        title: tags.name || 'parking zone',
        type: 'theft',
        source: 'OSM Civic Proxy',
        severity: 0.95 + distanceWeight * 1.05
      });
      return;
    }

    if (
      highway === 'bus_stop' ||
      railway === 'station' ||
      railway === 'halt' ||
      railway === 'subway_entrance' ||
      transitAmenities.has(amenity)
    ) {
      transit += 1;
      theftPressure += 0.48 * distanceWeight;
      violentPressure += 0.82 * distanceWeight;
      if (distanceWeight > 0.26) {
        hotspots.push({
          lat: coords.lat,
          lng: coords.lng,
          title: tags.name || 'transit hub',
          type: 'crime',
          source: 'OSM Civic Proxy',
          severity: 0.55 + distanceWeight * 0.9
        });
      }
      return;
    }

    if (commerceAmenities.has(amenity)) {
      theftPressure += 0.62 * distanceWeight;
      return;
    }

    if (amenity === 'police') {
      police += 1;
      protectionPressure += 3.4 * distanceWeight;
      return;
    }

    if (manMade === 'surveillance' || amenity === 'cctv') {
      surveillance += 1;
      protectionPressure += 1.15 * distanceWeight;
      return;
    }

    if (highway === 'street_lamp') {
      streetLights += 1;
      protectionPressure += 0.2 * distanceWeight;
    }
  });

  const theftScore = Math.max(0, theftPressure - protectionPressure * 0.72);
  const violentScore = Math.max(0, violentPressure - protectionPressure * 0.54);

  const theftCount = Math.min(42, Math.round(theftScore * 2.1));
  const violentCount = Math.min(20, Math.round(violentScore * 1.75));
  const total = theftCount + violentCount;
  const signalCoverage = clampRiskValue((nightlife + liquorShops + atms + parking + transit + police + surveillance + streetLights) / 34, 0, 1);

  return {
    source: 'osm-civic-risk-proxy',
    month: 'latest',
    total,
    theftCount,
    violentCount,
    hotspots: normalizeAndRankHotspots(hotspots, lat, lng, 30),
    proxy: true,
    coverage: signalCoverage,
    guardSignals: {
      police,
      surveillance,
      streetLights
    }
  };
}

function generateFallbackCrimeProxySignals(lat, lng) {
  const base = pseudoRandomFromCoords(lat, lng, 31.7);
  const theftCount = Math.round(2 + base * 4);
  const violentCount = Math.round(1 + pseudoRandomFromCoords(lat, lng, 88.2) * 2);
  const jitterA = 0.004 + base * 0.001;
  const jitterB = 0.003 + pseudoRandomFromCoords(lat, lng, 47.3) * 0.001;

  return {
    source: 'model-derived-risk-proxy',
    month: 'latest',
    total: theftCount + violentCount,
    theftCount,
    violentCount,
    hotspots: [
      {
        lat: lat + jitterA,
        lng: lng - jitterB,
        title: 'Civic activity cluster',
        type: 'theft',
        source: 'Model Proxy'
      },
      {
        lat: lat - jitterB,
        lng: lng + jitterA,
        title: 'Transit pressure point',
        type: 'violent',
        source: 'Model Proxy'
      }
    ],
    proxy: true,
    estimated: true,
    coverage: 0.18
  };
}

async function fetchRegionalCrimeProxySignals(lat, lng, radius = 2200) {
  const query = `
    [out:json][timeout:10];
    (
      node["amenity"~"bar|pub|nightclub|atm|bank|parking|parking_entrance|police|cctv|marketplace|bus_station|taxi"](around:${radius},${lat},${lng});
      way["amenity"~"bar|pub|nightclub|atm|bank|parking|parking_entrance|police|cctv|marketplace|bus_station|taxi"](around:${radius},${lat},${lng});
      node["shop"="alcohol"](around:${radius},${lat},${lng});
      way["shop"="alcohol"](around:${radius},${lat},${lng});
      node["highway"="bus_stop"](around:${radius},${lat},${lng});
      node["highway"="street_lamp"](around:${Math.round(radius * 0.7)},${lat},${lng});
      way["highway"="street_lamp"](around:${Math.round(radius * 0.7)},${lat},${lng});
      node["railway"~"station|halt|subway_entrance"](around:${radius},${lat},${lng});
      way["railway"~"station|halt|subway_entrance"](around:${radius},${lat},${lng});
      node["man_made"="surveillance"](around:${radius},${lat},${lng});
      way["man_made"="surveillance"](around:${radius},${lat},${lng});
    );
    out center body;
  `;

  try {
    const { data } = await fetchOverpassJson(query, 10000);
    return buildRegionalCrimeProxySignals(data.elements, lat, lng);
  } catch (err) {
    console.warn('Regional crime proxy failed, using model-derived proxy:', err);
    return generateFallbackCrimeProxySignals(lat, lng);
  }
}

function loadRiskModel() {
  try {
    const raw = localStorage.getItem(RISK_MODEL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Risk model cache load failed:', err);
  }

  return {
    samples: 0,
    avgObserved: 8,
    avgTheft: 1,
    avgViolent: 1,
    avgAccident: 2,
    updatedAt: Date.now()
  };
}

function saveRiskModel(model) {
  try {
    localStorage.setItem(RISK_MODEL_STORAGE_KEY, JSON.stringify(model));
  } catch (err) {
    console.warn('Risk model cache save failed:', err);
  }
}

function trainRiskModel(crimeData, accidentData, reliability = 0.5) {
  const model = loadRiskModel();
  const reliabilityWeight = clampRiskValue(reliability, 0.2, 1);
  const theftSignal = Number(crimeData.theftCount || 0) * 2.1;
  const violentSignal = Number(crimeData.violentCount || 0) * 1.75;
  const accidentSignal = Number(accidentData.weightedRisk || 0) * 1.05;
  const observedRaw = theftSignal + violentSignal + accidentSignal;
  const observed = observedRaw * (0.65 + reliabilityWeight * 0.55);

  model.samples += 1;
  const alpha = model.samples < 6 ? 0.34 : 0.16;
  model.avgObserved = model.avgObserved * (1 - alpha) + observed * alpha;
  model.avgTheft = model.avgTheft * (1 - alpha) + Number(crimeData.theftCount || 0) * alpha;
  model.avgViolent = model.avgViolent * (1 - alpha) + Number(crimeData.violentCount || 0) * alpha;
  model.avgAccident = model.avgAccident * (1 - alpha) + Number(accidentData.weightedRisk || 0) * alpha;
  model.updatedAt = Date.now();
  saveRiskModel(model);

  const delta = observed - model.avgObserved;
  let penalty = 0;

  if (observed > 0) {
    penalty = Math.round((observed * 0.76 + Math.max(0, delta) * (1.1 + reliabilityWeight * 0.6)) * reliabilityWeight);
    penalty = Math.max(0, Math.min(26, penalty));
  }

  const factors = [];
  const theftCount = Math.round(Number(crimeData.theftCount || 0));
  const violentCount = Math.round(Number(crimeData.violentCount || 0));
  const hazardCount = Math.round(Number(accidentData.hazardCount || 0));
  const signalCount = Math.round(Number(accidentData.signalCount || 0));

  if (theftCount > 0) factors.push(`${theftCount} weighted theft signals nearby`);
  if (violentCount > 0) factors.push(`${violentCount} weighted violent/public-order signals nearby`);
  if (hazardCount > 0) factors.push(`${hazardCount} mapped road hazard tags nearby`);
  if (signalCount > 0) factors.push(`${signalCount} dense traffic-conflict points`);
  if (reliabilityWeight < 0.5) factors.push('Signal confidence is limited; risk penalty is conservatively scaled');

  if (factors.length === 0) {
    factors.push('No elevated public incident pressure detected in current feeds');
  }

  return {
    penalty,
    factors,
    baseline: model.avgObserved,
    reliability: Number((reliabilityWeight * 100).toFixed(1))
  };
}

async function fetchRecentCrimeSignals(lat, lng) {
  // UK Police Data API is used as a public crime feed where coverage is available.
  if (!isLikelyUK(lat, lng)) {
    return fetchRegionalCrimeProxySignals(lat, lng);
  }

  try {
    const response = await fetchWithTimeout(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`, {}, 8000);
    if (!response.ok) {
      throw new Error(`Crime API returned ${response.status}`);
    }

    const crimes = await response.json();
    const crimeRows = Array.isArray(crimes) ? crimes : [];
    let weightedTheft = 0;
    let weightedViolent = 0;
    let weightedTotal = 0;
    let locatedReports = 0;
    const hotspotCandidates = [];

    crimeRows.forEach((crime) => {
      const location = crime && crime.location ? crime.location : null;
      const crimeLat = Number(location && location.latitude);
      const crimeLng = Number(location && location.longitude);
      if (!Number.isFinite(crimeLat) || !Number.isFinite(crimeLng)) return;

      locatedReports += 1;

      const category = String(crime && crime.category ? crime.category : 'crime').toLowerCase();
      const isTheft = THEFT_CATEGORIES.has(category);
      const isViolent = VIOLENT_CATEGORIES.has(category);
      const distance = getDistance(lat, lng, crimeLat, crimeLng);
      const distanceWeight = getDistanceDecayWeight(distance, 160, 2500);
      const recencyWeight = getCrimeRecencyWeight(crime && crime.month);
      const combinedWeight = distanceWeight * recencyWeight;
      const baseSignal = isViolent ? 1.75 : (isTheft ? 1.35 : 0.52);

      weightedTotal += combinedWeight * baseSignal;
      if (isTheft) weightedTheft += combinedWeight * 1.55;
      if (isViolent) weightedViolent += combinedWeight * 1.65;

      if (isTheft || isViolent || (distance < 1200 && combinedWeight > 0.38)) {
        hotspotCandidates.push({
          lat: crimeLat,
          lng: crimeLng,
          title: category.replace(/-/g, ' '),
          type: isTheft ? 'theft' : (isViolent ? 'violent' : 'crime'),
          source: 'UK Police Data',
          severity: combinedWeight * (isViolent ? 2.1 : (isTheft ? 1.75 : 1.05))
        });
      }
    });

    const theftCount = Math.min(48, Math.round(weightedTheft));
    const violentCount = Math.min(26, Math.round(weightedViolent));
    const total = Math.max(theftCount + violentCount, Math.round(weightedTotal));
    const month = crimeRows[0] && crimeRows[0].month ? crimeRows[0].month : 'latest';
    const coverage = crimeRows.length > 0
      ? clampRiskValue(locatedReports / crimeRows.length, 0, 1)
      : 0;

    return {
      source: 'uk-police-data',
      month,
      total,
      rawTotal: crimeRows.length,
      locatedReports,
      theftCount,
      violentCount,
      hotspots: normalizeAndRankHotspots(hotspotCandidates, lat, lng, 35),
      coverage
    };
  } catch (err) {
    console.warn('Crime signal fetch failed:', err);
    return {
      source: 'crime-feed-error',
      month: 'latest',
      total: 0,
      theftCount: 0,
      violentCount: 0,
      hotspots: [],
      coverage: 0,
      error: 'API_FAILED'
    };
  }
}

async function fetchAccidentRiskSignals(lat, lng, radius = 2000) {
  const signalRadius = Math.round(radius * 0.72);
  const conflictRadius = Math.round(radius * 0.62);

  const query = `
    [out:json][timeout:8];
    (
      node["hazard"~"accident|dangerous_curve|slippery|falling_rocks"](around:${radius},${lat},${lng});
      way["hazard"~"accident|dangerous_curve|slippery|falling_rocks"](around:${radius},${lat},${lng});
      node["accident"](around:${radius},${lat},${lng});
      way["accident"](around:${radius},${lat},${lng});
      node["highway"="traffic_signals"](around:${signalRadius},${lat},${lng});
      way["highway"="traffic_signals"](around:${signalRadius},${lat},${lng});
      node["junction"~"roundabout|circular"](around:${conflictRadius},${lat},${lng});
      way["junction"~"roundabout|circular"](around:${conflictRadius},${lat},${lng});
      node["highway"="crossing"](around:${conflictRadius},${lat},${lng});
      way["highway"="crossing"](around:${conflictRadius},${lat},${lng});
    );
    out center body;
  `;

  try {
    const { data } = await fetchOverpassJson(query, 7000);
    const hotspots = [];
    let hazardCount = 0;
    let signalCount = 0;
    let hazardScore = 0;
    let conflictScore = 0;

    (data.elements || []).forEach((el) => {
      const coords = extractElementCoordinates(el);
      if (!coords) return;

      const distance = getDistance(lat, lng, coords.lat, coords.lng);
      if (!Number.isFinite(distance) || distance > Math.round(radius * 1.2)) return;

      const distanceWeight = getDistanceDecayWeight(distance, 120, Math.round(radius * 1.2));

      const tags = el.tags || {};
      const hazardTag = String(tags.hazard || tags.accident || '').toLowerCase();
      const highwayTag = String(tags.highway || '').toLowerCase();
      const junctionTag = String(tags.junction || '').toLowerCase();

      const isSignal = highwayTag === 'traffic_signals';
      const isConflictPoint = isSignal || highwayTag === 'crossing' || junctionTag === 'roundabout' || junctionTag === 'circular';

      if (hazardTag) {
        hazardCount += 1;

        let severity = 1.8;
        if (hazardTag.includes('dangerous_curve')) severity = 2.9;
        else if (hazardTag.includes('slippery')) severity = 2.3;
        else if (hazardTag.includes('falling_rocks')) severity = 3.1;
        else if (hazardTag.includes('accident')) severity = 2.4;

        hazardScore += severity * distanceWeight;

        hotspots.push({
          lat: coords.lat,
          lng: coords.lng,
          title: hazardTag.replace(/_/g, ' '),
          type: 'accident',
          source: 'OpenStreetMap',
          severity: severity * distanceWeight + 0.5
        });
        return;
      }

      if (!isConflictPoint) return;

      signalCount += 1;
      const conflictSeverity = isSignal
        ? 0.58
        : (highwayTag === 'crossing' ? 0.75 : 0.88);
      conflictScore += conflictSeverity * distanceWeight;

      const label = isSignal
        ? 'traffic signals'
        : (highwayTag === 'crossing' ? 'crossing conflict point' : 'junction conflict point');

      hotspots.push({
        lat: coords.lat,
        lng: coords.lng,
        title: label,
        type: 'traffic',
        source: 'OpenStreetMap',
        severity: conflictSeverity * distanceWeight + 0.3
      });
    });

    const weightedRisk = Number((hazardScore * 1.7 + conflictScore).toFixed(2));
    const coverage = clampRiskValue((hazardCount + signalCount) / 46, 0, 1);

    return {
      source: 'osm-road-signals',
      hazardCount,
      signalCount,
      weightedRisk,
      coverage,
      hotspots: normalizeAndRankHotspots(hotspots, lat, lng, 40)
    };
  } catch (err) {
    console.warn('Accident signal fetch failed:', err);
    return {
      source: 'accident-feed-error',
      hazardCount: 0,
      signalCount: 0,
      weightedRisk: 0,
      hotspots: [],
      coverage: 0,
      error: 'API_FAILED'
    };
  }
}

async function fetchPublicSafetyRisk(lat, lng) {
  try {
    const [crimeData, accidentData] = await Promise.all([
      fetchRecentCrimeSignals(lat, lng),
      fetchAccidentRiskSignals(lat, lng)
    ]);

    const crimeFeedFailed = Boolean(crimeData.error);
    const accidentFeedFailed = Boolean(accidentData.error);
    const criticalError = crimeFeedFailed && accidentFeedFailed;

    const crimeReliability = getCrimeSignalReliability(crimeData);
    const accidentReliability = getAccidentSignalReliability(accidentData);
    const combinedReliability = clampRiskValue((crimeReliability * 0.62) + (accidentReliability * 0.38), 0, 1);
    const modelOutput = trainRiskModel(crimeData, accidentData, combinedReliability);
    const confidence = getRiskConfidenceLabel(combinedReliability, crimeData);

    const factors = Array.isArray(modelOutput.factors) ? [...modelOutput.factors] : [];
    if (combinedReliability < 0.45) {
      factors.push('Low-confidence regional coverage; estimates are conservative');
    } else if (combinedReliability > 0.72) {
      factors.push('High-confidence multi-source risk agreement');
    }

    const mergedHotspots = normalizeAndRankHotspots(
      [...(crimeData.hotspots || []), ...(accidentData.hotspots || [])],
      lat,
      lng,
      50
    );

    return {
      theftCount: Math.max(0, Math.round(Number(crimeData.theftCount || 0))),
      violentCount: Math.max(0, Math.round(Number(crimeData.violentCount || 0))),
      totalCrime: Math.max(0, Math.round(Number(crimeData.total || 0))),
      accidentHotspots: Math.max(0, Math.round(Number(accidentData.hazardCount || 0))),
      conflictPoints: Math.max(0, Math.round(Number(accidentData.signalCount || 0))),
      penalty: modelOutput.penalty,
      factors,
      baseline: modelOutput.baseline,
      confidence,
      reliabilityScore: Number((combinedReliability * 100).toFixed(1)),
      month: crimeData.month,
      hotspots: mergedHotspots,
      sources: {
        crime: crimeData.source,
        accidents: accidentData.source
      },
      dataQuality: {
        crime: Number((crimeReliability * 100).toFixed(1)),
        accidents: Number((accidentReliability * 100).toFixed(1))
      },
      partialError: crimeFeedFailed || accidentFeedFailed,
      criticalError,
      error: criticalError ? 'API_FAILED' : undefined
    };
  } catch (err) {
    console.warn('Public safety risk fetch failed:', err);
    return {
      theftCount: 0,
      violentCount: 0,
      totalCrime: 0,
      accidentHotspots: 0,
      conflictPoints: 0,
      penalty: 0,
      factors: ['Public risk feeds unavailable, using base model only'],
      confidence: 'low',
      reliabilityScore: 0,
      hotspots: [],
      sources: {
        crime: 'unavailable',
        accidents: 'unavailable'
      },
      dataQuality: {
        crime: 0,
        accidents: 0
      },
      partialError: true,
      criticalError: true,
      error: 'API_FAILED'
    };
  }
}

// ── Dynamic Safety Score Algorithm (Enhanced) ─────────────────
function calculateSafetyScore(hour, services, cameras, areaInfo, riskData = null) {
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

  // Factor 10: Public crime + accident intelligence
  if (riskData) {
    const riskPenalty = Math.max(0, Math.round(riskData.penalty || 0));
    if (riskPenalty > 0) {
      score -= riskPenalty;
      factors.push(`-${riskPenalty} (recent theft / accident risk signals)`);
    } else if (riskData.confidence === 'high' || riskData.confidence === 'medium') {
      score += 3;
      factors.push('+3 (low recent public incident pressure)');
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, factors };
}

// Generate risk factors based on the computed data
function generateRiskFactors(hour, services, cameras, areaInfo, riskData = null) {
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

  if (riskData) {
    if (riskData.theftCount > 0) risks.push(`${riskData.theftCount} recent theft-related reports`);
    if (riskData.violentCount > 0) risks.push(`${riskData.violentCount} recent violent/public-order reports`);
    if (riskData.accidentHotspots > 0) risks.push(`${riskData.accidentHotspots} mapped road hazard points nearby`);
    if (riskData.conflictPoints > 0) risks.push(`${riskData.conflictPoints} dense traffic-conflict nodes nearby`);

    if ((riskData.confidence === 'high' || riskData.confidence === 'medium') && (riskData.penalty || 0) === 0) {
      features.push('Low pressure from recent public incident feeds');
    }

    const usingProxyCrime = Boolean(
      riskData.sources && String(riskData.sources.crime || '').includes('proxy')
    );

    if (riskData.confidence === 'low' && usingProxyCrime) {
      features.push('Using proxy public-incident signals for this region');
    } else if (riskData.confidence === 'low') {
      risks.push('Limited official public incident coverage for this location');
    }
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

// ── Routing Engine (Turn-by-Turn + Optimization + Congestion Prediction) ───
const ROUTE_OPTIMIZATION_MODES = new Set(['balanced', 'fastest', 'safest', 'least-congested']);

function normalizeRouteOptimizationMode(mode) {
  const value = String(mode || 'balanced').trim().toLowerCase();
  return ROUTE_OPTIMIZATION_MODES.has(value) ? value : 'balanced';
}

function clampRouteMetric(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function sampleRoutePoints(path, maxPoints = 18) {
  const points = Array.isArray(path) ? path : [];
  if (points.length <= maxPoints) return points;

  const sampled = [];
  const stride = (points.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(points.length - 1, Math.round(i * stride));
    sampled.push(points[index]);
  }

  return sampled;
}

function estimateRouteHotspotExposure(path, riskData = null) {
  if (!riskData || !Array.isArray(riskData.hotspots) || riskData.hotspots.length === 0) {
    return { nearHotspots: 0, hotspotExposure: 0 };
  }

  const sampledPath = sampleRoutePoints(path, 18);
  if (!sampledPath.length) {
    return { nearHotspots: 0, hotspotExposure: 0 };
  }

  let nearHotspots = 0;

  for (const hotspot of riskData.hotspots.slice(0, 40)) {
    const hotspotLat = Number(hotspot.lat);
    const hotspotLng = Number(hotspot.lng);
    if (!Number.isFinite(hotspotLat) || !Number.isFinite(hotspotLng)) continue;

    let minDistance = Infinity;

    for (const point of sampledPath) {
      const pointLat = Number(point[0]);
      const pointLng = Number(point[1]);
      if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) continue;

      const distance = getDistance(pointLat, pointLng, hotspotLat, hotspotLng);
      if (distance < minDistance) minDistance = distance;
      if (minDistance <= 220) break;
    }

    if (minDistance <= 220) nearHotspots += 1;
  }

  const baseline = Math.max(1, Math.min(riskData.hotspots.length, 20));
  const hotspotExposure = clampRouteMetric(nearHotspots / baseline, 0, 1);

  return { nearHotspots, hotspotExposure };
}

function getCongestionTimeProfile(hour) {
  const normalizedHour = ((Math.round(hour) % 24) + 24) % 24;

  if ((normalizedHour >= 7 && normalizedHour <= 10) || (normalizedHour >= 17 && normalizedHour <= 20)) {
    return { base: 56, label: 'peak-hours' };
  }

  if (normalizedHour === 6 || normalizedHour === 11 || normalizedHour === 16 || normalizedHour === 21) {
    return { base: 42, label: 'shoulder-hours' };
  }

  if (normalizedHour >= 12 && normalizedHour <= 15) {
    return { base: 34, label: 'daytime' };
  }

  if (normalizedHour >= 22 || normalizedHour <= 4) {
    return { base: 18, label: 'night' };
  }

  return { base: 28, label: 'off-peak' };
}

function predictRouteCongestion(routeCandidate, profile = 'driving', options = {}) {
  const hour = Number.isFinite(options.hour) ? Number(options.hour) : new Date().getHours();
  const riskData = options && typeof options === 'object' ? options.riskData : null;
  const timeProfile = getCongestionTimeProfile(hour);

  const distanceKm = Math.max(0, Number(routeCandidate.distance || 0) / 1000);
  const stepCount = Array.isArray(routeCandidate.steps) ? routeCandidate.steps.length : 0;

  const { nearHotspots, hotspotExposure } = estimateRouteHotspotExposure(routeCandidate.path, riskData);

  const routePath = Array.isArray(routeCandidate.path) ? routeCandidate.path : [];
  const firstPoint = routePath.length ? routePath[0] : [0, 0];
  const lastPoint = routePath.length ? routePath[routePath.length - 1] : [0, 0];

  const seed = pseudoRandomFromCoords(
    Number(firstPoint[0] || 0) + Number(lastPoint[0] || 0),
    Number(firstPoint[1] || 0) + Number(lastPoint[1] || 0),
    (Number(routeCandidate.distance || 0) / 1000) + (Number(routeCandidate.duration || 0) / 60)
  );
  const deterministicNoise = (seed - 0.5) * 8;

  const riskPenalty = riskData
    ? clampRouteMetric(
      Number(riskData.accidentHotspots || 0) * 1.1 +
      Number(riskData.conflictPoints || 0) * 0.7 +
      Number(riskData.penalty || 0) * 0.45,
      0,
      22
    )
    : 0;

  let score = timeProfile.base;
  score += clampRouteMetric(distanceKm * 2.2, 2, 20);
  score += clampRouteMetric(stepCount * 0.6, 1, 18);
  score += hotspotExposure * 28;
  score += riskPenalty;
  score += deterministicNoise;

  const congestionScore = Math.round(clampRouteMetric(score, 8, 97));

  let level = 'moderate';
  if (congestionScore < 35) level = 'low';
  else if (congestionScore < 60) level = 'moderate';
  else if (congestionScore < 80) level = 'high';
  else level = 'severe';

  const delayMultiplier = profile === 'walking' ? 0.18 : 0.52;
  const delaySeconds = Math.round((Number(routeCandidate.duration || 0) * delayMultiplier) * (congestionScore / 100));
  const etaSeconds = Math.max(0, Math.round(Number(routeCandidate.duration || 0) + delaySeconds));

  let confidence = 'medium';
  if (!riskData) {
    confidence = 'low';
  } else if (String(riskData.confidence || '').toLowerCase() === 'high') {
    confidence = 'high';
  } else if (String(riskData.confidence || '').toLowerCase() === 'low') {
    confidence = 'low';
  }

  const factors = [];
  factors.push(timeProfile.label === 'peak-hours' ? 'Peak-hour traffic pressure' : 'Normal traffic window');
  if (nearHotspots > 0) factors.push(`${nearHotspots} incident hotspots near this path`);
  if (stepCount > 14) factors.push('High number of turns/intersections');

  return {
    score: congestionScore,
    level,
    delaySeconds: Math.max(0, delaySeconds),
    etaSeconds,
    confidence,
    nearHotspots,
    hotspotExposure,
    factors
  };
}

function mapGoogleDirectionsRouteCandidate(route, fallbackLat, fallbackLng, index = 0) {
  const leg = route && Array.isArray(route.legs) && route.legs.length > 0
    ? route.legs[0]
    : null;

  const endLat = leg && leg.end_location
    ? Number(typeof leg.end_location.lat === 'function' ? leg.end_location.lat() : leg.end_location.lat)
    : Number(fallbackLat);
  const endLng = leg && leg.end_location
    ? Number(typeof leg.end_location.lng === 'function' ? leg.end_location.lng() : leg.end_location.lng)
    : Number(fallbackLng);

  const path = Array.isArray(route && route.overview_path)
    ? route.overview_path
      .map(point => [
        Number(typeof point.lat === 'function' ? point.lat() : point.lat),
        Number(typeof point.lng === 'function' ? point.lng() : point.lng)
      ])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];

  const steps = (leg && Array.isArray(leg.steps) ? leg.steps : []).map((step, i) => {
    const instruction = stripHtmlTags(step.instructions || 'Continue');
    const distance = step.distance && step.distance.value ? Number(step.distance.value) : 0;
    const duration = step.duration && step.duration.value ? Number(step.duration.value) : 0;
    const stepLat = step.end_location
      ? Number(typeof step.end_location.lat === 'function' ? step.end_location.lat() : step.end_location.lat)
      : endLat;
    const stepLng = step.end_location
      ? Number(typeof step.end_location.lng === 'function' ? step.end_location.lng() : step.end_location.lng)
      : endLng;

    return {
      index: i,
      instruction,
      voiceInstruction: `${instruction}. Continue for ${formatDistance(Math.round(distance))}.`,
      distance: Math.round(distance),
      duration: Math.round(duration),
      lat: Number.isFinite(stepLat) ? stepLat : endLat,
      lng: Number.isFinite(stepLng) ? stepLng : endLng
    };
  });

  if (!steps.length) {
    const fallbackDistance = Math.round(leg && leg.distance && leg.distance.value ? Number(leg.distance.value) : 0);
    const fallbackDuration = Math.round(leg && leg.duration && leg.duration.value ? Number(leg.duration.value) : 0);

    steps.push({
      index: 0,
      instruction: 'Continue to destination',
      voiceInstruction: `Continue to destination for ${formatDistance(fallbackDistance)}.`,
      distance: fallbackDistance,
      duration: fallbackDuration,
      lat: Number.isFinite(endLat) ? endLat : Number(fallbackLat),
      lng: Number.isFinite(endLng) ? endLng : Number(fallbackLng)
    });
  }

  return {
    id: `google_route_${index + 1}`,
    label: `Route ${String.fromCharCode(65 + (index % 26))}`,
    source: 'google-directions-sdk',
    distance: Math.round(leg && leg.distance && leg.distance.value ? Number(leg.distance.value) : 0),
    duration: Math.round(leg && leg.duration && leg.duration.value ? Number(leg.duration.value) : 0),
    path: path.length > 1 ? path : [[Number(fallbackLat), Number(fallbackLng)], [Number(endLat), Number(endLng)]],
    steps
  };
}

function mapOsrmRouteCandidate(route, fallbackLat, fallbackLng, index = 0) {
  const leg = route && Array.isArray(route.legs) && route.legs[0]
    ? route.legs[0]
    : { steps: [] };

  const path = route && route.geometry && Array.isArray(route.geometry.coordinates)
    ? route.geometry.coordinates
      .map(pair => [Number(pair[1]), Number(pair[0])])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];

  const endPoint = path.length ? path[path.length - 1] : [Number(fallbackLat), Number(fallbackLng)];

  const steps = (Array.isArray(leg.steps) ? leg.steps : []).map((step, i) => {
    const maneuverLoc = step.maneuver && Array.isArray(step.maneuver.location)
      ? step.maneuver.location
      : [Number(fallbackLng), Number(fallbackLat)];
    const instruction = formatRouteInstruction(step);

    return {
      index: i,
      instruction,
      voiceInstruction: `${instruction}. Continue for ${formatDistance(Math.round(step.distance || 0))}.`,
      distance: Math.round(step.distance || 0),
      duration: Math.round(step.duration || 0),
      lat: Number(maneuverLoc[1]),
      lng: Number(maneuverLoc[0])
    };
  });

  if (!steps.length) {
    const fallbackDistance = Math.round(Number(route && route.distance ? route.distance : 0));
    const fallbackDuration = Math.round(Number(route && route.duration ? route.duration : 0));

    steps.push({
      index: 0,
      instruction: 'Continue to destination',
      voiceInstruction: `Continue to destination for ${formatDistance(fallbackDistance)}.`,
      distance: fallbackDistance,
      duration: fallbackDuration,
      lat: Number(endPoint[0]),
      lng: Number(endPoint[1])
    });
  }

  return {
    id: `osrm_route_${index + 1}`,
    label: `Route ${String.fromCharCode(65 + (index % 26))}`,
    source: 'osrm',
    distance: Math.round(Number(route && route.distance ? route.distance : 0)),
    duration: Math.round(Number(route && route.duration ? route.duration : 0)),
    path: path.length > 1 ? path : [[Number(fallbackLat), Number(fallbackLng)], [Number(endPoint[0]), Number(endPoint[1])]],
    steps
  };
}

function getRouteOptimizationWeights(mode) {
  if (mode === 'fastest') {
    return { eta: 0.62, distance: 0.20, congestion: 0.13, safety: 0.05 };
  }

  if (mode === 'safest') {
    return { eta: 0.08, distance: 0.04, congestion: 0.18, safety: 0.70 };
  }

  if (mode === 'least-congested') {
    return { eta: 0.21, distance: 0.09, congestion: 0.54, safety: 0.16 };
  }

  return { eta: 0.42, distance: 0.13, congestion: 0.27, safety: 0.18 };
}

function calculateRouteOptimizationScore(candidate, stats, mode, options = {}) {
  const weights = getRouteOptimizationWeights(mode);
  const minEta = Math.max(1, Number(stats.minEtaSeconds || 1));
  const minDistance = Math.max(1, Number(stats.minDistanceMeters || 1));
  const etaNorm = Number(candidate.congestion.etaSeconds || candidate.duration || 1) / minEta;
  const distanceNorm = Number(candidate.distance || 1) / minDistance;
  const congestionNorm = clampRouteMetric(Number(candidate.congestion.score || 0) / 100, 0, 1);
  const riskPenaltyBase = options && options.riskData ? Number(options.riskData.penalty || 0) : 6;
  const edgeAiScore = clampRouteMetric(Number(options && options.edgeAiScore ? options.edgeAiScore : 0), 0, 100);

  const hotspotExposure = Number(candidate.congestion.hotspotExposure || 0);
  const nearHotspots = Number(candidate.congestion.nearHotspots || 0);
  const confidence = String(candidate.congestion.confidence || 'medium').toLowerCase();
  const congestionLevel = String(candidate.congestion.level || 'moderate').toLowerCase();

  const congestionSafetyPenalty = congestionLevel === 'severe'
    ? 30
    : congestionLevel === 'high'
      ? 18
      : congestionLevel === 'moderate'
        ? 8
        : 2;

  let safetyPenaltyRaw =
    hotspotExposure * 82 +
    nearHotspots * 4.6 +
    riskPenaltyBase * (mode === 'safest' ? 1.25 : 0.8) +
    congestionSafetyPenalty;

  if (edgeAiScore > 0) {
    safetyPenaltyRaw += edgeAiScore * (mode === 'safest' ? 0.42 : 0.22);
  }

  if (mode === 'safest') {
    safetyPenaltyRaw += hotspotExposure * 20;
    safetyPenaltyRaw += Math.max(0, nearHotspots - 1) * 3.2;
    if (confidence === 'low') {
      // Prefer conservative route choices when public risk confidence is low.
      safetyPenaltyRaw += 6;
    }
  } else if (mode === 'fastest') {
    safetyPenaltyRaw *= 0.65;
  } else if (mode === 'least-congested') {
    safetyPenaltyRaw *= 0.9;
  }

  const safetyPenalty = clampRouteMetric(safetyPenaltyRaw, 0, 100);
  const safetyPriorityScore = Number((hotspotExposure * 100 + nearHotspots * 6 + congestionSafetyPenalty + (edgeAiScore * 0.8)).toFixed(2));
  const safetyNorm = safetyPenalty / 100;

  const optimizationScore =
    (etaNorm * weights.eta) +
    (distanceNorm * weights.distance) +
    (congestionNorm * weights.congestion) +
    (safetyNorm * weights.safety);

  return {
    optimizationScore: Number(optimizationScore.toFixed(4)),
    safetyPenalty: Math.round(safetyPenalty),
    safetyPriorityScore,
    edgeAiScore: Math.round(edgeAiScore)
  };
}

function optimizeRouteAlternatives(alternatives, mode = 'balanced', profile = 'driving', options = {}) {
  const normalizedMode = normalizeRouteOptimizationMode(mode);
  const candidates = Array.isArray(alternatives) ? alternatives : [];

  if (!candidates.length) {
    return {
      mode: normalizedMode,
      selectedRouteId: '',
      alternatives: []
    };
  }

  const enriched = candidates.map((candidate, index) => {
    const id = String(candidate.id || `route_${index + 1}`);
    const label = String(candidate.label || `Route ${String.fromCharCode(65 + (index % 26))}`);
    const congestion = predictRouteCongestion(candidate, profile, options);

    return {
      ...candidate,
      id,
      label,
      congestion
    };
  });

  const stats = {
    minEtaSeconds: Math.min(...enriched.map(candidate => Number(candidate.congestion.etaSeconds || candidate.duration || Infinity))),
    minDistanceMeters: Math.min(...enriched.map(candidate => Number(candidate.distance || Infinity)))
  };

  const scored = enriched.map((candidate) => {
    const scoreOutput = calculateRouteOptimizationScore(candidate, stats, normalizedMode, options);
    return {
      ...candidate,
      optimizationScore: scoreOutput.optimizationScore,
      safetyPenalty: scoreOutput.safetyPenalty,
      safetyPriorityScore: scoreOutput.safetyPriorityScore
    };
  });

  scored.sort((a, b) => {
    if (normalizedMode === 'safest') {
      const safetyPenaltyDelta = Number(a.safetyPenalty || 0) - Number(b.safetyPenalty || 0);
      if (Math.abs(safetyPenaltyDelta) >= 4) {
        return safetyPenaltyDelta;
      }

      const nearHotspotDelta = Number(a.congestion && a.congestion.nearHotspots || 0) - Number(b.congestion && b.congestion.nearHotspots || 0);
      if (nearHotspotDelta !== 0) {
        return nearHotspotDelta;
      }
    }

    return Number(a.optimizationScore || Infinity) - Number(b.optimizationScore || Infinity);
  });
  scored.forEach((candidate, index) => {
    candidate.isRecommended = index === 0;
  });

  return {
    mode: normalizedMode,
    selectedRouteId: scored[0].id,
    alternatives: scored
  };
}

function buildRouteBundle(source, alternatives, mode, profile, options = {}) {
  const optimized = optimizeRouteAlternatives(alternatives, mode, profile, options);
  if (!optimized.alternatives.length) return null;

  const selectedIndex = optimized.alternatives.findIndex(route => route.id === optimized.selectedRouteId);
  const selectedRoute = selectedIndex >= 0
    ? optimized.alternatives[selectedIndex]
    : optimized.alternatives[0];

  return {
    source,
    optimizationMode: optimized.mode,
    selectedRouteId: selectedRoute.id,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
    alternatives: optimized.alternatives,
    distance: selectedRoute.distance,
    duration: selectedRoute.duration,
    etaSeconds: selectedRoute.congestion ? selectedRoute.congestion.etaSeconds : selectedRoute.duration,
    path: selectedRoute.path,
    steps: selectedRoute.steps,
    congestion: selectedRoute.congestion
  };
}

function formatRouteInstruction(step) {
  const type = step.maneuver && step.maneuver.type ? step.maneuver.type : 'continue';
  const modifier = step.maneuver && step.maneuver.modifier ? step.maneuver.modifier : '';
  const road = step.name ? ` onto ${step.name}` : '';

  if (type === 'depart') return `Start and head ${modifier || 'forward'}${road}`.trim();
  if (type === 'arrive') return 'You have arrived at your destination';
  if (type === 'roundabout' || type === 'rotary') return `Enter roundabout and continue${road}`;
  if (type === 'fork') return `Keep ${modifier || 'ahead'}${road}`;
  if (type === 'merge') return `Merge ${modifier || 'ahead'}${road}`;
  if (type === 'on ramp') return `Take the ramp ${modifier || ''}${road}`.trim();
  if (type === 'off ramp') return `Take the exit ${modifier || ''}${road}`.trim();
  if (type === 'turn') return `Turn ${modifier || ''}${road}`.trim();
  if (type === 'end of road') return `At end of road, turn ${modifier || ''}${road}`.trim();

  return `Continue ${modifier || 'ahead'}${road}`.trim();
}

async function fetchRouteDirections(fromLat, fromLng, toLat, toLng, profile = 'driving', options = {}) {
  const optimizationMode = normalizeRouteOptimizationMode(options.mode);

  if (hasGoogleApiKey()) {
    try {
      const googleRoute = await fetchRouteDirectionsWithGoogle(fromLat, fromLng, toLat, toLng, profile);
      if (googleRoute && Array.isArray(googleRoute.alternatives) && googleRoute.alternatives.length > 0) {
        const optimizedGoogle = buildRouteBundle(
          googleRoute.source || 'google-directions-sdk',
          googleRoute.alternatives,
          optimizationMode,
          profile,
          options
        );

        if (optimizedGoogle) {
          return optimizedGoogle;
        }
      }
    } catch (err) {
      console.warn('Google directions failed, falling back to OSRM:', err);
      notifyGoogleFallback(err, 'OSRM routing');
    }
  }

  const routeProfile = profile === 'walking' ? 'foot' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${routeProfile}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&alternatives=true`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Routing API returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route returned');
    }

    const alternatives = data.routes
      .slice(0, 3)
      .map((route, index) => mapOsrmRouteCandidate(route, fromLat, fromLng, index))
      .filter(route => Array.isArray(route.path) && route.path.length > 1);

    if (!alternatives.length) {
      throw new Error('No usable route alternatives were returned');
    }

    const optimizedOsrm = buildRouteBundle('osrm', alternatives, optimizationMode, profile, options);
    if (optimizedOsrm) {
      return optimizedOsrm;
    }

    throw new Error('Route optimization returned no candidates');
  } catch (err) {
    console.warn('Route fetch failed, using fallback path:', err);
    const directDistance = Math.round(getDistance(fromLat, fromLng, toLat, toLng));
    const fallbackDuration = Math.round(directDistance / 13);
    const fallbackCandidate = {
      id: 'fallback_route_1',
      label: 'Direct fallback',
      source: 'fallback',
      distance: directDistance,
      duration: fallbackDuration,
      path: [[fromLat, fromLng], [toLat, toLng]],
      steps: [
        {
          index: 0,
          instruction: 'Routing service unavailable. Follow direct path to destination.',
          voiceInstruction: 'Routing service is unavailable. Follow the highlighted direct path to destination.',
          distance: directDistance,
          duration: fallbackDuration,
          lat: toLat,
          lng: toLng
        }
      ]
    };

    const fallbackBundle = buildRouteBundle('fallback', [fallbackCandidate], optimizationMode, profile, options);
    if (fallbackBundle) {
      fallbackBundle.error = 'API_FAILED';
      return fallbackBundle;
    }

    return {
      source: 'fallback',
      optimizationMode,
      selectedRouteId: fallbackCandidate.id,
      selectedIndex: 0,
      alternatives: [fallbackCandidate],
      distance: directDistance,
      duration: fallbackDuration,
      path: fallbackCandidate.path,
      steps: fallbackCandidate.steps,
      error: 'API_FAILED'
    };
  }
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
  // Keep a small delay so cards still feel dynamic without blocking the sidebar.
  await new Promise(r => setTimeout(r, 120 + Math.random() * 160));
  
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

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${hrs} hr`;
  return `${hrs} hr ${rem} min`;
}
