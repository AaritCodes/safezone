'use strict';

const { URL } = require('url');

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_RADIUS_METERS = 2600;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
  const num = toFiniteNumber(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'crime';
  const cleaned = raw.replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (cleaned.includes('vehicle') && cleaned.includes('theft')) return 'vehicle-theft';
  if (cleaned.includes('auto') && cleaned.includes('theft')) return 'vehicle-theft';
  if (cleaned.includes('robbery')) return 'robbery';
  if (cleaned.includes('burglary') || cleaned.includes('breakin') || cleaned.includes('break-in')) return 'burglary';
  if (cleaned.includes('theft') || cleaned.includes('larceny') || cleaned.includes('steal')) return 'theft';
  if (cleaned.includes('assault') || cleaned.includes('battery') || cleaned.includes('hurt')) return 'assault';
  if (cleaned.includes('murder') || cleaned.includes('homicide')) return 'murder';
  if (cleaned.includes('rape') || cleaned.includes('sexual')) return 'rape';
  if (cleaned.includes('molest')) return 'molestation';
  if (cleaned.includes('kidnap')) return 'kidnapping';
  if (cleaned.includes('riot')) return 'rioting';
  return cleaned || 'crime';
}

function normalizeMonth(value) {
  if (!value) return 'latest';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'latest';
  return date.toISOString().slice(0, 7);
}

function extractCoordinates(record) {
  if (!record) return null;
  const directLat = toFiniteNumber(record.latitude ?? record.lat ?? record.Latitude ?? record.Lat);
  const directLng = toFiniteNumber(record.longitude ?? record.lng ?? record.Longitude ?? record.Lng);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { lat: directLat, lng: directLng };
  }

  const location = record.location && typeof record.location === 'object' ? record.location : null;
  const locLat = location ? toFiniteNumber(location.latitude ?? location.lat) : NaN;
  const locLng = location ? toFiniteNumber(location.longitude ?? location.lng) : NaN;
  if (Number.isFinite(locLat) && Number.isFinite(locLng)) {
    return { lat: locLat, lng: locLng };
  }

  const geometry = record.geometry && typeof record.geometry === 'object' ? record.geometry : null;
  const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (coords && coords.length >= 2) {
    const geoLng = toFiniteNumber(coords[0]);
    const geoLat = toFiniteNumber(coords[1]);
    if (Number.isFinite(geoLat) && Number.isFinite(geoLng)) {
      return { lat: geoLat, lng: geoLng };
    }
  }

  const locationCoords = location && Array.isArray(location.coordinates) ? location.coordinates : null;
  if (locationCoords && locationCoords.length >= 2) {
    const locGeoLng = toFiniteNumber(locationCoords[0]);
    const locGeoLat = toFiniteNumber(locationCoords[1]);
    if (Number.isFinite(locGeoLat) && Number.isFinite(locGeoLng)) {
      return { lat: locGeoLat, lng: locGeoLng };
    }
  }

  const locationString = typeof record.location === 'string' ? record.location : '';
  if (locationString.includes(',')) {
    const [latText, lngText] = locationString.split(',').map(part => part.trim());
    const lat = toFiniteNumber(latText);
    const lng = toFiniteNumber(lngText);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

function extractTimestamp(record) {
  if (!record || typeof record !== 'object') return 'latest';
  const candidate = record.occurred_at || record.occurredAt || record.reported_at || record.reportedAt ||
    record.timestamp || record.time || record.date || record.datetime || record.datetime_utc;
  if (candidate) return normalizeMonth(candidate);

  const year = toFiniteNumber(record.year, NaN);
  const month = toFiniteNumber(record.month, NaN);
  if (Number.isFinite(year) && Number.isFinite(month)) {
    const normalizedMonth = String(Math.max(1, Math.min(12, Math.round(month)))).padStart(2, '0');
    return `${Math.round(year)}-${normalizedMonth}`;
  }

  return 'latest';
}

function extractCategory(record) {
  if (!record || typeof record !== 'object') return 'crime';
  const candidate = record.category || record.type || record.offense || record.offence || record.crime_type ||
    record.incident_type || record.primary_type || record.ucr || record.description || record.title;
  return normalizeCategory(candidate);
}

function normalizeRecord(record) {
  const coords = extractCoordinates(record);
  if (!coords) return null;
  if (coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) return null;

  const month = extractTimestamp(record);
  const category = extractCategory(record);
  const ipcSection = record && (record.ipc_section || record.ipcSection) ? String(record.ipc_section || record.ipcSection) : '';
  const id = record && (record.id || record.incident_id || record.case_id || record.crime_id)
    ? String(record.id || record.incident_id || record.case_id || record.crime_id)
    : '';

  return {
    id,
    latitude: coords.lat,
    longitude: coords.lng,
    category,
    month,
    ipc_section: ipcSection
  };
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isPlainObject(payload)) return [];

  if (Array.isArray(payload.incidents)) return payload.incidents;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.records)) return payload.records;

  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features.map((feature) => {
      const properties = isPlainObject(feature.properties) ? feature.properties : {};
      return {
        ...properties,
        geometry: feature.geometry
      };
    });
  }

  if (Array.isArray(payload.features)) {
    return payload.features.map((feature) => {
      const properties = isPlainObject(feature.properties) ? feature.properties : {};
      return {
        ...properties,
        geometry: feature.geometry
      };
    });
  }

  return [];
}

function normalizePayload(payload) {
  const records = extractRecords(payload);
  const incidents = [];
  for (const record of records) {
    const normalized = normalizeRecord(record);
    if (normalized) incidents.push(normalized);
  }
  return incidents;
}

function buildSinceTimestamp(lookbackDays) {
  const days = clampNumber(lookbackDays, 1, 365, DEFAULT_LOOKBACK_DAYS);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildUrl(config, params) {
  const lat = toFiniteNumber(params.lat);
  const lng = toFiniteNumber(params.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const radius = clampNumber(params.radius ?? config.defaultRadiusMeters, 250, 30000, DEFAULT_RADIUS_METERS);
  const since = params.since || buildSinceTimestamp(params.lookbackDays ?? config.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const state = params.state ? String(params.state).trim() : '';
  const template = String(config.urlTemplate || '').trim();
  const baseUrl = String(config.url || '').trim();

  if (template) {
    return template.replace(/\{(lat|lng|radius|since|state)\}/g, (match, key) => {
      if (key === 'lat') return encodeURIComponent(lat.toFixed(6));
      if (key === 'lng') return encodeURIComponent(lng.toFixed(6));
      if (key === 'radius') return encodeURIComponent(String(radius));
      if (key === 'since') return encodeURIComponent(String(since));
      if (key === 'state') return encodeURIComponent(state);
      return match;
    });
  }

  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lng', lng.toFixed(6));
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('since', String(since));
    if (state) url.searchParams.set('state', state);
    return url.toString();
  } catch (err) {
    return null;
  }
}

function buildHeaders(config) {
  const headers = {
    Accept: 'application/json'
  };
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) return headers;
  const headerName = String(config.apiKeyHeader || 'Authorization').trim() || 'Authorization';
  const prefix = String(config.apiKeyPrefix || 'Bearer').trim();
  headers[headerName] = prefix ? `${prefix} ${apiKey}` : apiKey;
  return headers;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createRealtimeCrimeClient(config = {}, logger = null) {
  const resolvedConfig = {
    enabled: config.enabled !== false,
    url: String(config.url || '').trim(),
    urlTemplate: String(config.urlTemplate || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    apiKeyHeader: String(config.apiKeyHeader || 'Authorization').trim(),
    apiKeyPrefix: String(config.apiKeyPrefix || 'Bearer').trim(),
    timeoutMs: clampNumber(config.timeoutMs, 500, 30000, 4500),
    defaultRadiusMeters: clampNumber(config.defaultRadiusMeters, 250, 30000, DEFAULT_RADIUS_METERS),
    lookbackDays: clampNumber(config.lookbackDays, 1, 365, DEFAULT_LOOKBACK_DAYS),
    providerName: String(config.providerName || '').trim()
  };

  const log = logger || {
    info() {},
    warn() {},
    error() {}
  };

  function isConfigured() {
    return resolvedConfig.enabled && Boolean(resolvedConfig.url || resolvedConfig.urlTemplate);
  }

  async function fetchIncidents(params = {}) {
    if (!isConfigured()) {
      return {
        ok: false,
        status: 503,
        code: 'NOT_CONFIGURED',
        message: 'Realtime crime feed is not configured.'
      };
    }

    const lat = toFiniteNumber(params.lat);
    const lng = toFiniteNumber(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_COORDS',
        message: 'Valid lat/lng are required.'
      };
    }

    const url = buildUrl(resolvedConfig, params);
    if (!url) {
      return {
        ok: false,
        status: 500,
        code: 'BAD_CONFIG',
        message: 'Realtime crime feed URL is invalid.'
      };
    }

    const headers = buildHeaders(resolvedConfig);
    let response;
    try {
      response = await fetchWithTimeout(url, { headers }, resolvedConfig.timeoutMs);
    } catch (err) {
      log.warn('realtime_crime.fetch_failed', { error: err && err.message ? err.message : err });
      return {
        ok: false,
        status: 502,
        code: 'UPSTREAM_UNREACHABLE',
        message: 'Realtime crime feed is unreachable.'
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok) {
      log.warn('realtime_crime.upstream_error', {
        status: response.status,
        body: payload
      });
      return {
        ok: false,
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: `Realtime crime feed returned ${response.status}.`
      };
    }

    const incidents = normalizePayload(payload);
    return {
      ok: true,
      status: 200,
      source: 'realtime-crime-api',
      provider: resolvedConfig.providerName || 'configured-feed',
      incidents,
      rawCount: Array.isArray(payload) ? payload.length : Array.isArray(payload && payload.incidents) ? payload.incidents.length : Array.isArray(payload && payload.data) ? payload.data.length : Array.isArray(payload && payload.results) ? payload.results.length : Array.isArray(payload && payload.records) ? payload.records.length : Array.isArray(payload && payload.features) ? payload.features.length : incidents.length
    };
  }

  return {
    isConfigured,
    fetchIncidents
  };
}

module.exports = {
  createRealtimeCrimeClient
};
