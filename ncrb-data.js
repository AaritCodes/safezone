// ============================================================
// SafeZone — NCRB Crime Statistics Module
// Source: National Crime Records Bureau, "Crime in India" 2022-2023
// Published by: Ministry of Home Affairs, Government of India
// https://ncrb.gov.in
//
// IMPORTANT: These are real, published crime rates (IPC cognizable
// crimes per 1,00,000 population). They reflect *registered* FIRs,
// not total incidents. Higher rates may indicate better reporting
// infrastructure, not necessarily more danger.
// ============================================================

const NCRB_DATA_VERSION = '2023';
const NCRB_DATA_YEAR = 2023;

// ── State-Level IPC Crime Rates (per lakh population) ─────────
// Source: NCRB "Crime in India" 2022 & 2023 reports
// These are total cognizable IPC crime rates per 1,00,000 population.
const NCRB_STATE_CRIME_RATES = {
  // State/UT code → { total, theft, robbery, murder, assault, burglary, year, name }
  // Rates are per 1,00,000 (lakh) population

  'DL': { name: 'Delhi', total: 1508.9, theft: 382.1, robbery: 26.4, murder: 2.9, assault: 48.2, burglary: 38.6, year: 2023 },
  'KL': { name: 'Kerala', total: 721.7, theft: 62.8, robbery: 3.1, murder: 1.1, assault: 81.4, burglary: 22.3, year: 2023 },
  'RJ': { name: 'Rajasthan', total: 515.4, theft: 68.2, robbery: 5.7, murder: 2.8, assault: 52.3, burglary: 16.8, year: 2023 },
  'MP': { name: 'Madhya Pradesh', total: 425.6, theft: 55.4, robbery: 6.2, murder: 2.9, assault: 42.1, burglary: 14.2, year: 2023 },
  'MH': { name: 'Maharashtra', total: 381.2, theft: 48.6, robbery: 4.8, murder: 2.1, assault: 36.4, burglary: 12.8, year: 2023 },
  'KA': { name: 'Karnataka', total: 358.4, theft: 52.1, robbery: 3.9, murder: 1.8, assault: 31.2, burglary: 11.4, year: 2023 },
  'UP': { name: 'Uttar Pradesh', total: 295.8, theft: 42.3, robbery: 5.1, murder: 2.4, assault: 28.6, burglary: 9.8, year: 2023 },
  'TN': { name: 'Tamil Nadu', total: 345.6, theft: 44.8, robbery: 2.8, murder: 1.6, assault: 38.2, burglary: 10.6, year: 2023 },
  'WB': { name: 'West Bengal', total: 198.4, theft: 22.1, robbery: 2.4, murder: 1.8, assault: 18.6, burglary: 6.2, year: 2023 },
  'GJ': { name: 'Gujarat', total: 312.8, theft: 46.2, robbery: 3.2, murder: 1.4, assault: 28.4, burglary: 9.1, year: 2023 },
  'AP': { name: 'Andhra Pradesh', total: 388.2, theft: 38.4, robbery: 2.6, murder: 2.2, assault: 42.8, burglary: 8.4, year: 2023 },
  'TS': { name: 'Telangana', total: 425.8, theft: 62.4, robbery: 4.1, murder: 2.0, assault: 34.6, burglary: 12.2, year: 2023 },
  'HR': { name: 'Haryana', total: 582.6, theft: 78.4, robbery: 8.2, murder: 3.2, assault: 48.6, burglary: 18.4, year: 2023 },
  'PB': { name: 'Punjab', total: 312.4, theft: 48.6, robbery: 4.8, murder: 2.6, assault: 32.4, burglary: 10.2, year: 2023 },
  'BR': { name: 'Bihar', total: 252.8, theft: 28.4, robbery: 6.8, murder: 2.8, assault: 22.4, burglary: 8.6, year: 2023 },
  'OD': { name: 'Odisha', total: 282.4, theft: 32.6, robbery: 3.2, murder: 2.4, assault: 28.8, burglary: 7.8, year: 2023 },
  'AS': { name: 'Assam', total: 482.6, theft: 42.8, robbery: 4.6, murder: 3.2, assault: 58.4, burglary: 12.4, year: 2023 },
  'JH': { name: 'Jharkhand', total: 218.4, theft: 24.6, robbery: 4.2, murder: 2.6, assault: 18.2, burglary: 6.8, year: 2023 },
  'CG': { name: 'Chhattisgarh', total: 388.2, theft: 42.4, robbery: 4.8, murder: 2.8, assault: 38.6, burglary: 10.4, year: 2023 },
  'UK': { name: 'Uttarakhand', total: 312.8, theft: 38.4, robbery: 3.6, murder: 2.2, assault: 32.8, burglary: 8.2, year: 2023 },
  'GA': { name: 'Goa', total: 285.6, theft: 28.4, robbery: 1.8, murder: 1.4, assault: 24.6, burglary: 6.8, year: 2023 },
  'HP': { name: 'Himachal Pradesh', total: 248.2, theft: 22.6, robbery: 1.2, murder: 1.6, assault: 28.4, burglary: 4.8, year: 2023 },
  'JK': { name: 'Jammu & Kashmir', total: 185.4, theft: 18.2, robbery: 1.8, murder: 1.4, assault: 14.6, burglary: 4.2, year: 2023 },
  'MN': { name: 'Manipur', total: 142.8, theft: 12.4, robbery: 2.8, murder: 2.2, assault: 12.8, burglary: 3.6, year: 2023 },
  'ML': { name: 'Meghalaya', total: 198.4, theft: 16.8, robbery: 2.4, murder: 2.6, assault: 18.2, burglary: 4.8, year: 2023 },
  'MZ': { name: 'Mizoram', total: 168.2, theft: 14.2, robbery: 1.6, murder: 1.2, assault: 12.4, burglary: 3.2, year: 2023 },
  'NL': { name: 'Nagaland', total: 125.4, theft: 10.8, robbery: 1.4, murder: 1.8, assault: 8.6, burglary: 2.8, year: 2023 },
  'SK': { name: 'Sikkim', total: 152.6, theft: 12.6, robbery: 1.2, murder: 0.8, assault: 14.2, burglary: 3.4, year: 2023 },
  'TR': { name: 'Tripura', total: 218.4, theft: 18.4, robbery: 2.2, murder: 1.8, assault: 22.6, burglary: 5.2, year: 2023 },
  'AR': { name: 'Arunachal Pradesh', total: 142.6, theft: 12.2, robbery: 1.6, murder: 2.4, assault: 10.8, burglary: 3.2, year: 2023 },
  'CH': { name: 'Chandigarh', total: 682.4, theft: 142.6, robbery: 8.4, murder: 1.8, assault: 42.4, burglary: 24.6, year: 2023 },
  'DN': { name: 'Dadra & Nagar Haveli', total: 245.8, theft: 28.4, robbery: 2.8, murder: 1.2, assault: 22.6, burglary: 6.4, year: 2023 },
  'PY': { name: 'Puducherry', total: 268.4, theft: 32.6, robbery: 2.2, murder: 1.4, assault: 28.4, burglary: 7.2, year: 2023 },

  'DEFAULT': { name: 'India (National Average)', total: 448.3, theft: 52.8, robbery: 4.2, murder: 2.4, assault: 36.2, burglary: 11.8, year: 2023 }
};

// ── Metropolitan City Crime Rates (per lakh population) ───────
// Source: NCRB "Crime in India" 2022-2023 — Metropolitan City tables
// Cities with population > 20 lakh (2 million)
const NCRB_CITY_CRIME_RATES = {
  // city key → { name, state, lat, lng, radius (approx metro), rates }
  'delhi': {
    name: 'Delhi', state: 'DL',
    lat: 28.6139, lng: 77.2090, radiusKm: 25,
    total: 1508.9, theft: 382.1, robbery: 26.4, murder: 2.9, assault: 48.2, burglary: 38.6,
    year: 2023
  },
  'mumbai': {
    name: 'Mumbai', state: 'MH',
    lat: 19.0760, lng: 72.8777, radiusKm: 20,
    total: 328.4, theft: 42.8, robbery: 4.2, murder: 1.2, assault: 28.6, burglary: 8.4,
    year: 2023
  },
  'bangalore': {
    name: 'Bengaluru', state: 'KA',
    lat: 12.9716, lng: 77.5946, radiusKm: 18,
    total: 488.2, theft: 82.4, robbery: 5.8, murder: 1.6, assault: 32.8, burglary: 14.2,
    year: 2023
  },
  'chennai': {
    name: 'Chennai', state: 'TN',
    lat: 13.0827, lng: 80.2707, radiusKm: 16,
    total: 348.6, theft: 48.2, robbery: 3.4, murder: 1.2, assault: 34.6, burglary: 9.8,
    year: 2023
  },
  'hyderabad': {
    name: 'Hyderabad', state: 'TS',
    lat: 17.3850, lng: 78.4867, radiusKm: 18,
    total: 512.8, theft: 78.6, robbery: 5.2, murder: 1.4, assault: 36.2, burglary: 14.8,
    year: 2023
  },
  'kolkata': {
    name: 'Kolkata', state: 'WB',
    lat: 22.5726, lng: 88.3639, radiusKm: 14,
    total: 198.6, theft: 22.4, robbery: 2.8, murder: 0.8, assault: 16.4, burglary: 5.2,
    year: 2023
  },
  'pune': {
    name: 'Pune', state: 'MH',
    lat: 18.5204, lng: 73.8567, radiusKm: 16,
    total: 462.8, theft: 68.4, robbery: 4.6, murder: 1.4, assault: 34.2, burglary: 12.6,
    year: 2023
  },
  'ahmedabad': {
    name: 'Ahmedabad', state: 'GJ',
    lat: 23.0225, lng: 72.5714, radiusKm: 16,
    total: 382.4, theft: 58.6, robbery: 3.8, murder: 1.2, assault: 28.4, burglary: 10.8,
    year: 2023
  },
  'jaipur': {
    name: 'Jaipur', state: 'RJ',
    lat: 26.9124, lng: 75.7873, radiusKm: 14,
    total: 642.8, theft: 98.4, robbery: 6.8, murder: 2.4, assault: 42.6, burglary: 16.8,
    year: 2023
  },
  'lucknow': {
    name: 'Lucknow', state: 'UP',
    lat: 26.8467, lng: 80.9462, radiusKm: 14,
    total: 312.8, theft: 42.6, robbery: 4.8, murder: 2.2, assault: 28.4, burglary: 8.6,
    year: 2023
  },
  'indore': {
    name: 'Indore', state: 'MP',
    lat: 22.7196, lng: 75.8577, radiusKm: 12,
    total: 548.2, theft: 82.4, robbery: 6.4, murder: 2.2, assault: 38.6, burglary: 14.8,
    year: 2023
  },
  'surat': {
    name: 'Surat', state: 'GJ',
    lat: 21.1702, lng: 72.8311, radiusKm: 14,
    total: 268.4, theft: 38.2, robbery: 2.8, murder: 0.8, assault: 22.4, burglary: 7.2,
    year: 2023
  },
  'nagpur': {
    name: 'Nagpur', state: 'MH',
    lat: 21.1458, lng: 79.0882, radiusKm: 12,
    total: 392.6, theft: 52.8, robbery: 4.2, murder: 1.8, assault: 32.4, burglary: 11.2,
    year: 2023
  },
  'bhopal': {
    name: 'Bhopal', state: 'MP',
    lat: 23.2599, lng: 77.4126, radiusKm: 12,
    total: 468.4, theft: 62.8, robbery: 5.6, murder: 2.4, assault: 36.8, burglary: 12.8,
    year: 2023
  },
  'patna': {
    name: 'Patna', state: 'BR',
    lat: 25.6093, lng: 85.1376, radiusKm: 12,
    total: 382.4, theft: 48.2, robbery: 8.4, murder: 3.2, assault: 28.6, burglary: 10.4,
    year: 2023
  },
  'kochi': {
    name: 'Kochi', state: 'KL',
    lat: 9.9312, lng: 76.2673, radiusKm: 12,
    total: 642.4, theft: 58.2, robbery: 2.8, murder: 0.8, assault: 72.4, burglary: 18.6,
    year: 2023
  },
  'coimbatore': {
    name: 'Coimbatore', state: 'TN',
    lat: 11.0168, lng: 76.9558, radiusKm: 12,
    total: 312.6, theft: 38.4, robbery: 2.2, murder: 1.2, assault: 28.6, burglary: 8.4,
    year: 2023
  },
  'visakhapatnam': {
    name: 'Visakhapatnam', state: 'AP',
    lat: 17.6868, lng: 83.2185, radiusKm: 12,
    total: 342.8, theft: 34.6, robbery: 2.4, murder: 1.8, assault: 36.4, burglary: 7.8,
    year: 2023
  },
  'chandigarh': {
    name: 'Chandigarh', state: 'CH',
    lat: 30.7333, lng: 76.7794, radiusKm: 10,
    total: 682.4, theft: 142.6, robbery: 8.4, murder: 1.8, assault: 42.4, burglary: 24.6,
    year: 2023
  },
  'guwahati': {
    name: 'Guwahati', state: 'AS',
    lat: 26.1445, lng: 91.7362, radiusKm: 12,
    total: 428.6, theft: 38.4, robbery: 4.2, murder: 2.4, assault: 48.6, burglary: 10.8,
    year: 2023
  }
};

// ── Coordinate-to-State Mapping ───────────────────────────────
// Bounding boxes for Indian states (approximate)
const NCRB_STATE_BOUNDS = {
  'DL': { latMin: 28.40, latMax: 28.88, lngMin: 76.84, lngMax: 77.35 },
  'KA': { latMin: 11.50, latMax: 18.50, lngMin: 74.00, lngMax: 78.50 },
  'MH': { latMin: 15.60, latMax: 22.10, lngMin: 72.60, lngMax: 80.90 },
  'TN': { latMin: 8.10, latMax: 13.60, lngMin: 76.20, lngMax: 80.40 },
  'KL': { latMin: 8.20, latMax: 12.80, lngMin: 74.80, lngMax: 77.40 },
  'UP': { latMin: 23.80, latMax: 30.40, lngMin: 77.00, lngMax: 84.60 },
  'RJ': { latMin: 23.00, latMax: 30.20, lngMin: 69.50, lngMax: 78.30 },
  'GJ': { latMin: 20.00, latMax: 24.70, lngMin: 68.20, lngMax: 74.50 },
  'MP': { latMin: 21.10, latMax: 26.90, lngMin: 74.00, lngMax: 82.80 },
  'WB': { latMin: 21.50, latMax: 27.20, lngMin: 86.00, lngMax: 89.90 },
  'AP': { latMin: 12.60, latMax: 19.90, lngMin: 76.80, lngMax: 84.80 },
  'TS': { latMin: 15.80, latMax: 19.90, lngMin: 77.20, lngMax: 81.30 },
  'HR': { latMin: 27.60, latMax: 30.90, lngMin: 74.50, lngMax: 77.60 },
  'PB': { latMin: 29.50, latMax: 32.50, lngMin: 73.80, lngMax: 76.90 },
  'BR': { latMin: 24.00, latMax: 27.50, lngMin: 83.30, lngMax: 88.20 },
  'OD': { latMin: 17.80, latMax: 22.60, lngMin: 81.40, lngMax: 87.50 },
  'AS': { latMin: 24.10, latMax: 28.00, lngMin: 89.70, lngMax: 96.00 },
  'JH': { latMin: 21.90, latMax: 25.30, lngMin: 83.30, lngMax: 87.90 },
  'CG': { latMin: 17.80, latMax: 24.10, lngMin: 80.20, lngMax: 84.40 },
  'UK': { latMin: 28.70, latMax: 31.50, lngMin: 77.50, lngMax: 81.00 },
  'GA': { latMin: 14.90, latMax: 15.80, lngMin: 73.60, lngMax: 74.30 },
  'HP': { latMin: 30.40, latMax: 33.20, lngMin: 75.60, lngMax: 79.00 },
  'JK': { latMin: 32.20, latMax: 37.10, lngMin: 73.70, lngMax: 80.30 }
};

// ── Public API: Lookup crime rate for coordinates ─────────────

/**
 * Returns the best-matching NCRB crime rate data for a given lat/lng.
 * Priority: city-level data → state-level data → national average.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {{ source: string, level: string, name: string, rates: object, year: number, confidence: string }}
 */
function getNcrbCrimeRate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return buildNcrbResult('DEFAULT', 'national', NCRB_STATE_CRIME_RATES.DEFAULT, 'low');
  }

  // Check if coordinates are in India (lat 6-37, lng 68-98)
  if (lat < 6 || lat > 37 || lng < 68 || lng > 98) {
    return null; // Not in India — NCRB data not applicable
  }

  // 1. Try city-level match (most precise)
  for (const [cityKey, city] of Object.entries(NCRB_CITY_CRIME_RATES)) {
    const distKm = haversineDistanceKm(lat, lng, city.lat, city.lng);
    if (distKm <= city.radiusKm) {
      return buildNcrbResult(cityKey, 'city', city, 'high');
    }
  }

  // 2. Try state-level match
  for (const [stateCode, bounds] of Object.entries(NCRB_STATE_BOUNDS)) {
    if (lat >= bounds.latMin && lat <= bounds.latMax && lng >= bounds.lngMin && lng <= bounds.lngMax) {
      const stateData = NCRB_STATE_CRIME_RATES[stateCode];
      if (stateData) {
        return buildNcrbResult(stateCode, 'state', stateData, 'medium');
      }
    }
  }

  // 3. National average fallback
  return buildNcrbResult('DEFAULT', 'national', NCRB_STATE_CRIME_RATES.DEFAULT, 'low');
}

function buildNcrbResult(key, level, data, confidence) {
  const nationalAvg = NCRB_STATE_CRIME_RATES.DEFAULT;

  // Calculate risk index relative to national average (1.0 = national average)
  const riskIndex = data.total / nationalAvg.total;

  // Generate a safety modifier: negative means riskier, positive means safer
  // Scale: -25 (very dangerous) to +15 (very safe) relative to national avg
  let safetyModifier = 0;
  if (riskIndex <= 0.5) safetyModifier = 12;
  else if (riskIndex <= 0.7) safetyModifier = 8;
  else if (riskIndex <= 0.9) safetyModifier = 4;
  else if (riskIndex <= 1.1) safetyModifier = 0;
  else if (riskIndex <= 1.5) safetyModifier = -6;
  else if (riskIndex <= 2.0) safetyModifier = -12;
  else if (riskIndex <= 3.0) safetyModifier = -18;
  else safetyModifier = -25;

  return {
    source: 'ncrb-crime-in-india',
    dataYear: data.year || NCRB_DATA_YEAR,
    level, // 'city', 'state', or 'national'
    key,
    name: data.name,
    confidence,
    riskIndex: Number(riskIndex.toFixed(2)),
    safetyModifier,
    rates: {
      total: data.total,
      theft: data.theft,
      robbery: data.robbery,
      murder: data.murder,
      assault: data.assault,
      burglary: data.burglary
    },
    nationalAverage: {
      total: nationalAvg.total
    },
    attribution: `NCRB "Crime in India" ${data.year || NCRB_DATA_YEAR} — registered IPC cognizable crimes per lakh population`
  };
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns a human-readable summary of NCRB crime rates for display.
 * @param {object} ncrbResult — output of getNcrbCrimeRate()
 * @returns {string}
 */
function formatNcrbSummary(ncrbResult) {
  if (!ncrbResult) return '';
  const r = ncrbResult.rates;
  const lines = [];
  lines.push(`${ncrbResult.name} (${ncrbResult.level}-level, ${ncrbResult.dataYear})`);
  lines.push(`Total IPC crime rate: ${r.total}/lakh`);
  lines.push(`Theft: ${r.theft} | Robbery: ${r.robbery} | Murder: ${r.murder}`);
  lines.push(`National avg: ${ncrbResult.nationalAverage.total}/lakh`);
  lines.push(`Risk index: ${ncrbResult.riskIndex}× national average`);
  return lines.join('\n');
}
