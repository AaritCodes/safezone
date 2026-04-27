// js/modules/utils.js

export function normalizeDisplayText(text, maxLength = 100) {
  if (!text || typeof text !== 'string') return '';
  const stripped = text.replace(/<[^>]*>/g, '').trim();
  if (stripped.length <= maxLength) return stripped;
  return stripped.substring(0, maxLength - 3) + '...';
}

export function withTimeoutFallback(promise, timeoutMs, fallbackValue, label = 'request') {
  return new Promise((resolve) => {
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
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        console.warn(`${label} failed:`, err);
        resolve(typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue);
      });
  });
}

export function sanitizeIdentifier(value, maxLen = 40) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, maxLen);
}

export function safeMapCoordinate(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return fallback;
  }
  return Number(numeric.toFixed(6));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeJsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function sanitizePhoneNumber(phone) {
  const raw = String(phone || '').trim();
  const compact = raw.replace(/[^\d+]/g, '');
  const normalizedDigits = compact.replace(/\+/g, '');
  const hasLeadingPlus = compact.startsWith('+');
  return `${hasLeadingPlus ? '+' : ''}${normalizedDigits}`;
}

export function isValidPhoneNumber(phone) {
  return /^\+?\d{6,20}$/.test(String(phone || ''));
}

export function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '');
}

export function formatTime(hour) {
  const isPM = hour >= 12;
  const h = hour % 12 || 12;
  return `${h}:00 ${isPM ? 'PM' : 'AM'}`;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${Math.max(0, Math.round(totalSeconds))} sec`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const remainingM = m % 60;
  return remainingM > 0 ? `${h}h ${remainingM}m` : `${h}h`;
}

export function formatIncidentSourceLabel(source) {
  if (!source || typeof source !== 'string') return 'Public feed';
  const s = source.toLowerCase();
  if (s.includes('google')) return 'Google Intelligence';
  if (s.includes('osm') || s.includes('openstreetmap')) return 'OSM Community Signals';
  if (s.includes('estimated') || s.includes('proxy')) return 'Regional Risk Proxy';
  if (s.includes('backend')) return 'SafeZone Backend';
  return source.charAt(0).toUpperCase() + source.slice(1);
}
