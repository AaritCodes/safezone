// ============================================================
// SafeZone — Edge AI Sensor Fusion Module
// Local, Privacy-Preserving Machine Learning Simulation
// ============================================================

const EdgeAI = (function() {
  // State
  let isActive = false;
  let audioContext = null;
  let analyser = null;
  let microphone = null;
  let animationFrameId = null;
  
  // Sensor Data
  let currentAudioLevel = 0; // 0 to 100
  let currentMotionLevel = 0; // 0 to 100
  let rapidMotionDetected = false;
  let loudNoiseDetected = false;
  
  // Weights & Thresholds
  const AUDIO_THRESHOLD = 75; // Decibel equivalent threshold for "loud"
  const MOTION_THRESHOLD = 20; // Acceleration threshold for "running/falling"
  
  // Local Event Emitter
  const listeners = [];
  
  function triggerUpdate() {
    listeners.forEach(cb => cb({
      isActive,
      audioLevel: currentAudioLevel,
      motionLevel: currentMotionLevel,
      rapidMotionDetected,
      loudNoiseDetected,
      anomalyScore: getAnomalyScore()
    }));
  }

  // --- Audio Processing --- //
  async function startAudioProcessing() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      
      // Fast response for sudden noise
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4; 
      
      microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      
      processAudio();
    } catch (err) {
      console.warn("Edge AI: Microphone access denied or unavailable.", err);
      // Fallback or alert user
      if (typeof showNotification === 'function') {
        showNotification("Microphone access denied. Audio AI disabled.", "warning");
      }
    }
  }
  
  function processAudio() {
    if (!isActive || !analyser) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS (Root Mean Square) for volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    
    // Map RMS (approx 0-128) to a 0-100 scale
    currentAudioLevel = Math.min(100, (rms / 128) * 100);
    
    // Anomaly Detection: Sudden loud noise
    const wasLoud = loudNoiseDetected;
    loudNoiseDetected = currentAudioLevel > AUDIO_THRESHOLD;
    
    if (wasLoud !== loudNoiseDetected) {
      triggerUpdate();
      if (loudNoiseDetected && typeof showNotification === 'function') {
        showNotification("⚠️ Edge AI Detected: Unusual Audio Splike", "warning");
      }
    }
    
    animationFrameId = requestAnimationFrame(processAudio);
  }

  function stopAudioProcessing() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (microphone) microphone.disconnect();
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
    }
    currentAudioLevel = 0;
    loudNoiseDetected = false;
  }

  // --- Motion Processing --- //
  function startMotionProcessing() {
    if (window.DeviceMotionEvent) {
      // iOS 13+ requires explicit permission for DeviceMotionEvent
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
          .then(permissionState => {
            if (permissionState === 'granted') {
              window.addEventListener('devicemotion', handleMotion, false);
            } else {
              console.warn("Edge AI: Motion sensor permission denied.");
            }
          })
          .catch(console.error);
      } else {
        // Non-iOS 13+ devices
        window.addEventListener('devicemotion', handleMotion, false);
      }
    } else {
      console.warn("Edge AI: Device motion not supported on this device/browser.");
    }
  }
  
  function handleMotion(event) {
    if (!isActive) return;
    
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc) return;
    
    // Vector magnitude minus approximate gravity if only accelerationIncludingGravity is available
    let totalForce = 0;
    if (event.acceleration) {
      totalForce = Math.sqrt(
        (acc.x || 0) ** 2 + 
        (acc.y || 0) ** 2 + 
        (acc.z || 0) ** 2
      );
    } else {
      // Rough approximation if raw gravity is included
      totalForce = Math.abs(Math.sqrt(
        (acc.x || 0) ** 2 + 
        (acc.y || 0) ** 2 + 
        (acc.z || 0) ** 2
      ) - 9.81);
    }
    
    // Scale for percentage visualization (approximate max typical force is 30m/s^2)
    currentMotionLevel = Math.min(100, (totalForce / 30) * 100);
    
    const wasRapid = rapidMotionDetected;
    rapidMotionDetected = totalForce > MOTION_THRESHOLD;
    
    if (wasRapid !== rapidMotionDetected) {
      triggerUpdate();
      if (rapidMotionDetected && typeof showNotification === 'function') {
         showNotification("⚠️ Edge AI Detected: Rapid Acceleration/Fall", "warning");
      }
    }
  }

  function stopMotionProcessing() {
    window.removeEventListener('devicemotion', handleMotion, false);
    currentMotionLevel = 0;
    rapidMotionDetected = false;
  }

  // --- Public AI Logic --- //
  
  // Calculate dynamic localized anomaly penalty
  function getAnomalyScore() {
    if (!isActive) return 0;
    
    let penalty = 0;
    if (loudNoiseDetected) penalty += 20; // High audio penalty
    if (rapidMotionDetected) penalty += 25; // High motion penalty
    if (loudNoiseDetected && rapidMotionDetected) penalty += 15; // Synergistic penalty
    
    // Return penalty as a negative modifier to safety score
    return penalty;
  }

  return {
    toggle: async function() {
      if (isActive) {
        isActive = false;
        stopAudioProcessing();
        stopMotionProcessing();
        if (typeof showNotification === 'function') {
          showNotification("🛡️ Edge AI Disengaged", "info");
        }
      } else {
        isActive = true;
        await startAudioProcessing();
        startMotionProcessing();
        if (typeof showNotification === 'function') {
          showNotification("🛡️ Edge AI Guardian Active (Privacy Ensured)", "success");
        }
      }
      triggerUpdate();
      return isActive;
    },
    
    isActive: () => isActive,
    getAnomalyScore: getAnomalyScore,
    
    // Add listener for real-time UI updates
    subscribe: (cb) => {
      listeners.push(cb);
    },
    
    // For non-mobile browser demo/testing purposes
    simulateAnomaly: function(type) {
      if (!isActive) return;
      if (type === 'audio') {
        loudNoiseDetected = true;
        currentAudioLevel = 85;
      } else if (type === 'motion') {
        rapidMotionDetected = true;
        currentMotionLevel = 80;
      }
      triggerUpdate();
      setTimeout(() => {
        loudNoiseDetected = false;
        rapidMotionDetected = false;
        currentAudioLevel = 10;
        currentMotionLevel = 5;
        triggerUpdate();
      }, 3000);
    }
  };
})();
