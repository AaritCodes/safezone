// ============================================================
// SafeZone — Core Application Logic (ES Modules)
// ============================================================

import { state } from './js/modules/state.js';
import { initStorage } from './js/modules/storage.js';
import * as config from './js/modules/config.js';
import * as api from './js/modules/api.js';
import * as ui from './js/modules/ui.js';
import * as mapMod from './js/modules/map.js';

// Several modules still reference shared helpers as globals.
Object.assign(window, config, api, ui, mapMod);

document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  
  // Initialize map and UI
  mapMod.initMap();

  // Attach static event listeners
  const timeSlider = document.getElementById('timeSlider');
  if (timeSlider) {
    timeSlider.addEventListener('input', ui.onTimeChange);
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', ui.onSearchKeydown);
  }

  if (typeof window.EdgeAI !== 'undefined') {
    window.EdgeAI.subscribe(() => {
      ui.refreshSelectedSidebar();
      if (state.activeRoute && state.routeDestination) {
        ui.refreshMobilityIntelligence({ notify: false, keepViewport: true });
      }
    });
  }

  const routeModeSelect = document.getElementById('routeModeSelect');
  if (routeModeSelect) {
    routeModeSelect.addEventListener('change', () => {
      if (!state.activeRoute || !state.routeDestination) return;
      state.activeRoute.optimizationMode = ui.getSelectedRouteMode();
      ui.refreshMobilityIntelligence({ notify: false, keepViewport: true });
      // Use window.showNotification to avoid another import
      // or we can import it.
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
});
