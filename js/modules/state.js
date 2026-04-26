export const state = {
  map: null,
  heatLayer: null,
  selectedMarker: null,
  routeLayer: null,
  routeAlternativeLayers: [],
  emergencyLayerGroup: null,
  cameraLayerGroup: null,
  propertiesLayerGroup: null,
  riskLayerGroup: null,
  
  currentHour: new Date().getHours(),
  layerState: { heatmap: true, cameras: true, emergency: true, properties: true, risk: true },
  currentMapCenter: [28.6139, 77.2090], // Default: New Delhi
  
  lastFetchedServices: null,
  lastFetchedCameras: [],
  lastFetchedProperties: [],
  lastAreaInfo: null,
  lastRiskData: null,
  
  isFetching: false,
  hasApiErrors: false,
  activeScanRequestId: 0,
  
  favoriteLocations: [], // Will be loaded by storage.js
  emergencyContacts: [], // Will be loaded by storage.js
  
  activeRoute: null,
  routeDestination: null,
  routeStepIndex: 0,
  navigationWatchId: null,
  mobilityRefreshTimerId: null,
  lastMobilityRefreshAt: 0,
  lastMobilitySuggestionAt: 0,
  lastMobilitySuggestedRouteId: '',
  
  speechRecognition: null,
  isVoiceListening: false,
  
  lastGoogleFallbackNoticeAt: 0,
  lastGoogleFallbackNoticeKey: '',
  
  googleMapsLoaded: false,
  googleMapsLoadingPromise: null,
  currentCountryCode: 'IN'
};
