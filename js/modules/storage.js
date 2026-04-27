// js/modules/storage.js
import { sanitizeIdentifier, normalizeDisplayText, safeMapCoordinate, sanitizePhoneNumber, isValidPhoneNumber } from './utils.js';
import { MAX_FAVORITES, MAX_EMERGENCY_CONTACTS, FAVORITES_STORAGE_KEY, CONTACTS_STORAGE_KEY } from './config.js';
import { state } from './state.js';

export function canUseLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch (err) {
    return false;
  }
}

export function parseStoredArray(key) {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`Failed to parse storage key ${key}:`, err);
    return [];
  }
}

export function persistStoredArray(key, value) {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to persist storage key ${key}:`, err);
  }
}

function sanitizeFavoriteEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const lat = Number(entry.lat);
  const lng = Number(entry.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const name = normalizeDisplayText(entry.name, 80) || 'Saved location';
  const ts = Number(entry.timestamp);
  return {
    lat,
    lng,
    name,
    timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now()
  };
}

function sanitizeEmergencyContactEntry(entry, fallbackId) {
  if (!entry || typeof entry !== 'object') return null;
  const name = normalizeDisplayText(entry.name, 40);
  const phone = sanitizePhoneNumber(entry.phone);
  const id = sanitizeIdentifier(entry.id, 40) || fallbackId;
  if (!name || !isValidPhoneNumber(phone)) return null;
  return { id, name, phone };
}

export function loadFavoriteLocations() {
  const parsed = parseStoredArray(FAVORITES_STORAGE_KEY);
  const sanitized = [];
  parsed.forEach((entry) => {
    const normalized = sanitizeFavoriteEntry(entry);
    if (!normalized) return;
    sanitized.push(normalized);
  });
  return sanitized.slice(0, MAX_FAVORITES);
}

export function loadEmergencyContacts() {
  const parsed = parseStoredArray(CONTACTS_STORAGE_KEY);
  const sanitized = [];
  const seen = new Set();
  parsed.forEach((entry, index) => {
    const normalized = sanitizeEmergencyContactEntry(entry, `contact_${index + 1}`);
    if (!normalized) return;
    const dedupeKey = normalized.phone;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    sanitized.push(normalized);
  });
  return sanitized.slice(0, MAX_EMERGENCY_CONTACTS);
}

export function initStorage() {
  state.favoriteLocations = loadFavoriteLocations();
  state.emergencyContacts = loadEmergencyContacts();
}

export function persistFavoriteLocations() {
  persistStoredArray(FAVORITES_STORAGE_KEY, state.favoriteLocations);
}

export function persistEmergencyContacts() {
  persistStoredArray(CONTACTS_STORAGE_KEY, state.emergencyContacts);
}
