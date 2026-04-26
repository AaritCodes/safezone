// js/modules/config.js

export const MAP_CENTER = [28.6139, 77.2090];
export const MAP_ZOOM = 13;

const GOOGLE_API_KEY = '';
const GOOGLE_API_KEY_META_NAME = 'safezone-google-api-key';

const BACKEND_BASE_URL = '';
const BACKEND_BASE_URL_META_NAME = 'safezone-backend-base-url';

const BACKEND_API_KEY = '';
const BACKEND_API_KEY_META_NAME = 'safezone-backend-api-key';

export const SCAN_SOFT_DEADLINE_MS = 6000;
export const SCAN_CALL_TIMEOUT_MS = 9000;
export const MOBILITY_REFRESH_INTERVAL_MS = 9000;
export const MOBILITY_NOTIFICATION_COOLDOWN_MS = 22000;
export const MOBILITY_SWITCH_MIN_GAIN_SECONDS = 75;

export const FAVORITES_STORAGE_KEY = 'safezoneFavorites';
export const CONTACTS_STORAGE_KEY = 'safezoneEmergencyContacts';
export const MAX_FAVORITES = 40;
export const MAX_EMERGENCY_CONTACTS = 5;

function normalizeGoogleApiKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^your[_\s-]?google[_\s-]?api[_\s-]?key$/i.test(raw)) {
    return '';
  }

  if (!/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return '';
  }

  return raw;
}

function readGoogleApiKeyFromMetaTag() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const meta = document.querySelector(`meta[name="${GOOGLE_API_KEY_META_NAME}"]`);
  if (!meta) return '';
  return normalizeGoogleApiKey(meta.getAttribute('content'));
}

export function getGoogleApiKey() {
  if (typeof window !== 'undefined' && typeof window.SAFEZONE_GOOGLE_API_KEY === 'string') {
    const windowKey = normalizeGoogleApiKey(window.SAFEZONE_GOOGLE_API_KEY);
    if (windowKey) return windowKey;
  }
  const metaKey = readGoogleApiKeyFromMetaTag();
  if (metaKey) return metaKey;
  return normalizeGoogleApiKey(GOOGLE_API_KEY);
}

export function hasGoogleApiKey() {
  const key = getGoogleApiKey();
  return Boolean(key && key.length > 20);
}

function normalizeBackendBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '');
  if (raw.startsWith('/')) return raw.replace(/\/$/, '');
  return '';
}

function readBackendBaseUrlFromMetaTag() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const meta = document.querySelector(`meta[name="${BACKEND_BASE_URL_META_NAME}"]`);
  if (!meta) return '';
  return normalizeBackendBaseUrl(meta.getAttribute('content'));
}

export function getBackendBaseUrl() {
  if (typeof window !== 'undefined' && typeof window.SAFEZONE_BACKEND_BASE_URL === 'string') {
    const fromWindow = normalizeBackendBaseUrl(window.SAFEZONE_BACKEND_BASE_URL);
    if (fromWindow) return fromWindow;
  }
  const fromMeta = readBackendBaseUrlFromMetaTag();
  if (fromMeta) return fromMeta;
  return normalizeBackendBaseUrl(BACKEND_BASE_URL);
}

export function buildBackendApiUrl(path) {
  const baseUrl = getBackendBaseUrl();
  const cleanedPath = String(path || '').trim();
  if (!baseUrl || !cleanedPath) return '';
  return `${baseUrl}${cleanedPath.startsWith('/') ? cleanedPath : `/${cleanedPath}`}`;
}

function normalizeBackendApiKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^your[_\s-]?backend[_\s-]?api[_\s-]?key$/i.test(raw)) return '';
  if (!/^[A-Za-z0-9._-]{10,256}$/.test(raw)) return '';
  return raw;
}

function readBackendApiKeyFromMetaTag() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const meta = document.querySelector(`meta[name="${BACKEND_API_KEY_META_NAME}"]`);
  if (!meta) return '';
  return normalizeBackendApiKey(meta.getAttribute('content'));
}

export function getBackendApiKey() {
  if (typeof window !== 'undefined' && typeof window.SAFEZONE_BACKEND_API_KEY === 'string') {
    const fromWindow = normalizeBackendApiKey(window.SAFEZONE_BACKEND_API_KEY);
    if (fromWindow) return fromWindow;
  }
  const fromMeta = readBackendApiKeyFromMetaTag();
  if (fromMeta) return fromMeta;
  return normalizeBackendApiKey(BACKEND_API_KEY);
}
