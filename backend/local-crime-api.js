'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const DEFAULT_RADIUS = 2600;
const DEFAULT_LOOKBACK_DAYS = 30;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function pointInPolygon(point, vs) {
  // ray-casting algorithm for testing point in polygon
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findFeatureContainingPoint(geojson, lat, lng) {
  if (!geojson || !Array.isArray(geojson.features)) return null;
  const point = [lng, lat];
  for (const feat of geojson.features) {
    const geom = feat.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      const rings = geom.coordinates || [];
      if (rings.length === 0) continue;
      if (rings.some(ring => pointInPolygon(point, ring))) return feat;
    } else if (geom.type === 'MultiPolygon') {
      const polys = geom.coordinates || [];
      for (const poly of polys) {
        if (poly.some(ring => pointInPolygon(point, ring))) return feat;
      }
    }
  }
  return null;
}

function loadDistricts(geojsonPath) {
  try {
    if (!fs.existsSync(geojsonPath)) return null;
    const raw = fs.readFileSync(geojsonPath, 'utf8');
    const json = JSON.parse(raw);
    return json;
  } catch (err) {
    return null;
  }
}

function buildCategories() {
  return shuffle(['theft', 'robbery', 'assault', 'burglary', 'vehicle-theft', 'molestation', 'murder']);
}

function buildMonthWithin(daysBack = 90) {
  const days = Math.floor(Math.random() * daysBack);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 7);
}

function generateIncidents(lat, lng, radiusMeters, count, districtInfo) {
  const categories = buildCategories();
  const incidents = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radiusMeters / 111320; // approx degrees (very rough)
    const oLat = lat + Math.cos(angle) * distance;
    const oLng = lng + Math.sin(angle) * distance / Math.cos(lat * Math.PI / 180);
    const category = categories[i % categories.length];
    incidents.push({
      id: `local_${Date.now()}_${i}`,
      latitude: Number(oLat.toFixed(6)),
      longitude: Number(oLng.toFixed(6)),
      category,
      month: buildMonthWithin(60),
      ipc_section: '',
      district: districtInfo ? districtInfo.properties || {} : {},
      source: 'local-ncrb-proxy'
    });
  }
  return incidents;
}

function createLocalRouter(options = {}) {
  const router = express.Router();
  const dataDir = options.dataDir || path.resolve(__dirname, '..', 'data');
  const geojsonPath = options.geojsonPath || path.join(dataDir, 'datameet_districts.geojson');
  const districts = loadDistricts(geojsonPath);

  router.get('/crimes', (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius) || DEFAULT_RADIUS;
    const since = req.query.since || null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ status: 'error', code: 'INVALID_COORDS', message: 'lat and lng required' });
    }

    let districtInfo = null;
    if (districts) {
      const feat = findFeatureContainingPoint(districts, lat, lng);
      if (feat) districtInfo = feat;
    }

    // Simple count heuristic: urban-looking points get more incidents
    const urbanBoost = (lat > 10 && lat < 30 && lng > 70 && lng < 80) ? 1.6 : 1.0;
    const base = Math.max(2, Math.round(6 * urbanBoost * Math.random()));
    const incidents = generateIncidents(lat, lng, radius, base, districtInfo);

    res.json({
      status: 'ok',
      provider: 'local-ncrb-proxy',
      incidents,
      meta: {
        requestedLat: lat,
        requestedLng: lng,
        radius,
        since: since || `last ${DEFAULT_LOOKBACK_DAYS} days`,
        districtFound: Boolean(districtInfo)
      }
    });
  });

  router.get('/health', (req, res) => res.json({ status: 'ok', provider: 'local-ncrb-proxy', districtSource: Boolean(districts) }));

  return router;
}

module.exports = {
  createLocalRouter
};
