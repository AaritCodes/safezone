// js/modules/utils.js

export function normalizeDisplayText(value, maxLen = 80) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
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

export function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${Math.max(0, Math.round(totalSeconds))} sec`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const remainingM = m % 60;
  return remainingM > 0 ? `${h}h ${remainingM}m` : `${h}h`;
}
