// js/modules/scoring.js
import { safeMapCoordinate } from './utils.js';

export function getSafetyLevel(score) {
  if (score >= 80) return { label: 'Very Safe', class: 'very-safe', icon: '🟢' };
  if (score >= 60) return { label: 'Moderately Safe', class: 'moderate', icon: '🟡' };
  if (score >= 40) return { label: 'Use Caution', class: 'caution', icon: '🟠' };
  return { label: 'High Risk', class: 'danger', icon: '🔴' };
}

export function clampRiskValue(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function calculateSafetyScore(hour, services, cameras, areaInfo, riskData = null, coords = null) {
  if (
    riskData &&
    riskData.productAssessment &&
    Number.isFinite(Number(riskData.productAssessment.score))
  ) {
    const product = riskData.productAssessment;
    const score = clampRiskValue(Number(product.score), 0, 100);
    const productFactors = Array.isArray(product.factors) ? product.factors.slice(0, 8) : [];
    const productPenalty = Math.max(0, Math.round(Number(product.penalty || 0)));

    if (productPenalty > 0) {
      productFactors.push(`-${productPenalty} (backend multi-signal risk penalty)`);
    }

    if (riskData.cvSignals && Number.isFinite(Number(riskData.cvSignals.score))) {
      productFactors.push(
        `CV scene risk: ${Math.round(Number(riskData.cvSignals.score || 0))}/100 (${String(riskData.cvSignals.level || 'low')})`
      );
    }

    if (productFactors.length === 0) {
      productFactors.push('Product-grade backend risk model score');
    }

    return {
      score: Math.round(score),
      factors: productFactors
    };
  }

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

  // Factor 9: On-Device Sensor Guardian (Microphone / Accelerometer)
  if (typeof window !== 'undefined' && typeof window.EdgeAI !== 'undefined' && window.EdgeAI.isActive()) {
    const edgeAnomaly = window.EdgeAI.getAnomalyScore();
    if (edgeAnomaly > 0) {
      score -= edgeAnomaly;
      factors.push(`-${edgeAnomaly} (Sensor Guardian: Local Anomaly Detected)`);
    } else {
      score += 5;
      factors.push(`+5 (Sensor Guardian Active)`);
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

  // Factor 11: NCRB published crime statistics (India only)
  if (typeof window !== 'undefined' && typeof window.getNcrbCrimeRate === 'function' && coords) {
    const ncrbData = window.getNcrbCrimeRate(coords.lat, coords.lng);
    if (ncrbData) {
      score += ncrbData.safetyModifier;
      const direction = ncrbData.safetyModifier >= 0 ? '+' : '';
      const levelLabel = ncrbData.level === 'city' ? ncrbData.name : (ncrbData.level === 'state' ? `${ncrbData.name} state` : 'India avg');
      factors.push(`${direction}${ncrbData.safetyModifier} (NCRB ${ncrbData.dataYear}: ${levelLabel} crime rate ${ncrbData.riskIndex}× national avg)`);
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, factors };
}

export function generateRiskFactors(hour, services, cameras, areaInfo, riskData = null) {
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

    if (riskData.cvSignals) {
      const cvScore = Math.round(Number(riskData.cvSignals.score || 0));
      const cvLevel = String(riskData.cvSignals.level || 'low').toLowerCase();
      const detections = Math.round(Number(riskData.cvSignals.detections || 0));

      if (cvScore >= 65 || cvLevel === 'high' || cvLevel === 'critical') {
        risks.push(`CV anomaly pressure is elevated (${cvScore}/100)`);
      } else if (cvScore >= 38 || cvLevel === 'moderate') {
        risks.push(`CV scene shows moderate anomaly pressure (${cvScore}/100)`);
      } else {
        features.push(`CV scene analysis indicates stable local dynamics (${cvScore}/100)`);
      }

      if (detections > 0) {
        features.push(`Scene simulation processed ${detections} detections`);
      }

      if (Array.isArray(riskData.cvSignals.signals) && riskData.cvSignals.signals.length > 0) {
        riskData.cvSignals.signals.slice(0, 2).forEach((signal) => {
          const safeSignal = String(signal || '').trim();
          if (!safeSignal) return;
          if (cvScore >= 55) risks.push(safeSignal);
          else features.push(safeSignal);
        });
      }
    }

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

    if (riskData.productAssessment && Array.isArray(riskData.productAssessment.recommendations)) {
      riskData.productAssessment.recommendations.slice(0, 2).forEach((recommendation) => {
        const text = String(recommendation || '').trim();
        if (!text) return;
        features.push(text);
      });
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
