// ============================================================
// SafeZone — Core Application Logic (ES Modules)
// ============================================================

import { state } from './js/modules/state.js';
import { initStorage } from './js/modules/storage.js';
import * as ui from './js/modules/ui.js';
import * as mapMod from './js/modules/map.js';

// Expose UI functions to window for dynamic HTML onclick handlers
window.loadAreaData = ui.loadAreaData;\nwindow.tryRenderSidebar = ui.tryRenderSidebar;\nwindow.compactServicePayload = ui.compactServicePayload;\nwindow.buildBackendSafetyPayload = ui.buildBackendSafetyPayload;\nwindow.enrichRiskDataWithBackendAssessment = ui.enrichRiskDataWithBackendAssessment;\nwindow.refreshSelectedSidebar = ui.refreshSelectedSidebar;\nwindow.showSidebarLoading = ui.showSidebarLoading;\nwindow.normalizeHourValue = ui.normalizeHourValue;\nwindow.getConfidenceTone = ui.getConfidenceTone;\nwindow.buildSafetyOutlookSummary = ui.buildSafetyOutlookSummary;\nwindow.buildEmergencyReadinessSummary = ui.buildEmergencyReadinessSummary;\nwindow.buildSafetyChecklist = ui.buildSafetyChecklist;\nwindow.updateSidebar = ui.updateSidebar;\nwindow.openSidebar = ui.openSidebar;\nwindow.closeSidebar = ui.closeSidebar;\nwindow.onTimeChange = ui.onTimeChange;\nwindow.updateTimeDisplay = ui.updateTimeDisplay;\nwindow.toggleFavorite = ui.toggleFavorite;\nwindow.findSafestHomes = ui.findSafestHomes;\nwindow.toggleLayer = ui.toggleLayer;\nwindow.normalizeSearchQuery = ui.normalizeSearchQuery;\nwindow.getCountryNameFromCode = ui.getCountryNameFromCode;\nwindow.buildGeocodeQueryVariants = ui.buildGeocodeQueryVariants;\nwindow.buildSearchViewbox = ui.buildSearchViewbox;\nwindow.buildNominatimSearchUrl = ui.buildNominatimSearchUrl;\nwindow.fetchNominatimCandidates = ui.fetchNominatimCandidates;\nwindow.scoreGeocodeCandidate = ui.scoreGeocodeCandidate;\nwindow.geocodeQuery = ui.geocodeQuery;\nwindow.searchLocation = ui.searchLocation;\nwindow.onSearchKeydown = ui.onSearchKeydown;\nwindow.handleVoiceCommand = ui.handleVoiceCommand;\nwindow.setVoiceSearchState = ui.setVoiceSearchState;\nwindow.toggleVoiceSearch = ui.toggleVoiceSearch;\nwindow.openDirectionsPanel = ui.openDirectionsPanel;\nwindow.closeDirectionsPanel = ui.closeDirectionsPanel;\nwindow.getSelectedRouteMode = ui.getSelectedRouteMode;\nwindow.getRouteModeLabel = ui.getRouteModeLabel;\nwindow.getEdgeAISignal = ui.getEdgeAISignal;\nwindow.getRouteMobilityInsight = ui.getRouteMobilityInsight;\nwindow.getCongestionClass = ui.getCongestionClass;\nwindow.getCongestionLabel = ui.getCongestionLabel;\nwindow.getRouteEtaSeconds = ui.getRouteEtaSeconds;\nwindow.getRouteRefreshAgeLabel = ui.getRouteRefreshAgeLabel;\nwindow.syncActiveRouteSelection = ui.syncActiveRouteSelection;\nwindow.stopMobilityRefreshLoop = ui.stopMobilityRefreshLoop;\nwindow.startMobilityRefreshLoop = ui.startMobilityRefreshLoop;\nwindow.refreshMobilityIntelligence = ui.refreshMobilityIntelligence;\nwindow.refreshMobilityInsightNow = ui.refreshMobilityInsightNow;\nwindow.applyRecommendedRoute = ui.applyRecommendedRoute;\nwindow.getCurrentLocation = ui.getCurrentLocation;\nwindow.renderDirectionsPanel = ui.renderDirectionsPanel;\nwindow.selectRouteAlternative = ui.selectRouteAlternative;\nwindow.startDirectionsTo = ui.startDirectionsTo;\nwindow.startDirectionsFromInput = ui.startDirectionsFromInput;\nwindow.speakText = ui.speakText;\nwindow.speakRouteOverview = ui.speakRouteOverview;\nwindow.highlightCurrentRouteStep = ui.highlightCurrentRouteStep;\nwindow.startVoiceNavigation = ui.startVoiceNavigation;\nwindow.stopVoiceNavigation = ui.stopVoiceNavigation;\nwindow.renderEmergencyContacts = ui.renderEmergencyContacts;\nwindow.openEmergencyContacts = ui.openEmergencyContacts;\nwindow.closeEmergencyContacts = ui.closeEmergencyContacts;\nwindow.saveEmergencyContact = ui.saveEmergencyContact;\nwindow.removeEmergencyContact = ui.removeEmergencyContact;\nwindow.callEmergencyContact = ui.callEmergencyContact;\nwindow.triggerSOSCall = ui.triggerSOSCall;\nwindow.toggleEdgeAI = ui.toggleEdgeAI;
window.initMap = mapMod.initMap;\nwindow.initHeatmap = mapMod.initHeatmap;\nwindow.updateHeatmap = mapMod.updateHeatmap;\nwindow.updateEmergencyMarkers = mapMod.updateEmergencyMarkers;\nwindow.createServicePopup = mapMod.createServicePopup;\nwindow.updateCameraMarkers = mapMod.updateCameraMarkers;\nwindow.createCameraPopup = mapMod.createCameraPopup;\nwindow.updatePropertyMarkers = mapMod.updatePropertyMarkers;\nwindow.createPropertyPopup = mapMod.createPropertyPopup;\nwindow.updateRiskMarkers = mapMod.updateRiskMarkers;\nwindow.withTimeoutFallback = mapMod.withTimeoutFallback;\nwindow.onMapClick = mapMod.onMapClick;\nwindow.clearRouteDrawing = mapMod.clearRouteDrawing;\nwindow.drawRoute = mapMod.drawRoute;

document.addEventListener('DOMContentLoaded', () => {
  initStorage();
  
  // Initialize map and UI
  mapMod.initMap();

  // Attach static event listeners
  const timeSlider = document.getElementById('timeSlider');
  if (timeSlider) {
    timeSlider.addEventListener('input', ui.onTimeChange);
  }

  const searchInput = document.getElementById('locationSearch');
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
