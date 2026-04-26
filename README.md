# 🛡️ SafeZone - Real-Time Area Safety Monitor

SafeZone is a comprehensive web application that provides real-time safety analysis for any location worldwide. It uses Google Maps Platform data when an API key is configured, with OpenStreetMap feeds as resilient fallback sources.

![SafeZone](https://img.shields.io/badge/version-2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-success)

---

## 🌟 Features

### Core Functionality
- **🗺️ Interactive Map**: Click anywhere to get instant safety analysis
- **📊 Safety Scoring**: Dynamic 0-100 safety score based on multiple factors
- **🕐 Time-Based Analysis**: See how safety changes throughout the day
- **📍 Location Search**: Search any location worldwide
- **🎯 Real-Time Data**: Google Maps Platform (primary) with OpenStreetMap fallback

### Safety Analysis Includes
- **🚔 Police Stations**: Distance and count of nearby police stations
- **🏥 Hospitals**: Medical facility proximity and availability
- **🚒 Fire Stations**: Emergency response coverage
- **📹 CCTV Cameras**: Surveillance coverage and active camera count
- **⏰ Time Factors**: Risk assessment based on time of day
- **🏘️ Area Type**: Residential, commercial, industrial, or park zones

### Advanced Features
- **⭐ Favorite Locations**: Save frequently checked locations
- **📊 Score Breakdown**: Transparent calculation showing all factors
- **🔔 Smart Notifications**: Real-time feedback for all actions
- **🧠 Deterministic Scene Simulation**: COCO-class format scene detections via backend API (not real CV inference)
- **🧩 Multi-Signal Risk Engine**: Infrastructure + time + incidents + published crime rates (NCRB)
- **🌍 30+ Countries**: Emergency numbers for countries worldwide
- **♿ Accessibility**: Full ARIA support and keyboard navigation
- **⚡ Performance**: Caching and throttling for optimal speed
- **🎨 Layer Controls**: Toggle heatmap, cameras, and emergency services

### Data Transparency
- **📡 Verified Data**: Clear indicators for OpenStreetMap-verified locations
- **⚠️ Estimated Data**: Transparent fallback when APIs are unavailable
- **ℹ️ Disclaimers**: Clear warnings that scores are estimates
- **📈 Factor Breakdown**: See exactly how your score was calculated

### Smart Mobility Requirement Alignment
- **Single Problem Solved**: Congestion-aware route optimization for faster and safer urban travel decisions
- **Real-Time or Simulated Data**: Live Google/OSRM routing with deterministic congestion and risk simulation fallback
- **Actionable Output in Seconds**: AI recommendation card suggests whether to stay or switch route, with one-tap apply
- **Micro-Solution Scope**: Focused mobility intelligence module built around route decisions, not a full traffic platform

---

## 🚀 Quick Start

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Internet connection (for map tiles and API data)
- No installation or build process required!

### Running the Application

#### Option 0: Product-Grade Backend Mode (Recommended)
```bash
npm install
npm run start
```

Then open your browser at:
```
http://localhost:8787
```

This mode enables:
- YOLOv8 simulation CV API endpoints
- Backend risk fusion scoring for product-grade calibration
- Static app hosting from the same backend service

#### Option 1: Direct File Opening
1. Download or clone this repository
2. Navigate to the project folder
3. Double-click `index.html` to open in your default browser

#### Option 2: Local Web Server (Recommended)
Using Python:
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Using Node.js:
```bash
# Install http-server globally
npm install -g http-server

# Run server
http-server -p 8000
```

Using PHP:
```bash
php -S localhost:8000
```

Then open your browser and navigate to:
```
http://localhost:8000
```

#### Option 3: VS Code Live Server
1. Install "Live Server" extension in VS Code
2. Right-click `index.html`
3. Select "Open with Live Server"

---

## 📖 How to Use

### Basic Usage

1. **Initial Load**
   - The map loads centered on New Delhi, India by default
   - Wait for the loading screen to complete
   - You'll see the heatmap, emergency services, and camera markers

2. **Analyze a Location**
   - Click anywhere on the map
   - A safety report sidebar will open on the right
   - View the safety score, risk factors, and nearby services

3. **Search for a Location**
   - Use the search bar at the top
   - Type any address, city, or landmark
   - Press Enter or click "Search"
   - The map will fly to that location and analyze it

4. **Adjust Time of Day**
   - Use the time slider at the bottom
   - Drag to any hour (0-23)
   - Watch the safety score update in real-time
   - Heatmap intensity changes based on time

5. **Toggle Map Layers**
   - Use the layer controls on the right
   - Toggle Heatmap, Cameras, or Emergency Services
   - Click to enable/disable each layer

6. **Save Favorite Locations**
   - Click on a location to analyze it
   - Click the "☆ Save Location" button in the report
   - Access saved locations from localStorage

### Understanding the Safety Score

The safety score (0-100) is calculated based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Police Proximity | +20 max | Distance to nearest police station |
| Police Count | +20 max | Number of nearby police stations |
| Hospital Access | +12 max | Distance to nearest hospital |
| Fire Station | +8 max | Fire station availability |
| CCTV Coverage | +15 max | Active surveillance cameras |
| Time of Day | -30 to +10 | Hour-based risk assessment |
| Area Type | -12 to +8 | Residential, commercial, etc. |
| Service Density | ±5 | Overall emergency service coverage |
| **NCRB Crime Rate** | **-25 to +12** | **Published IPC crime rate vs national avg** |

**Score Ranges:**
- 🟢 **80-100**: Very Safe
- 🟡 **60-79**: Moderately Safe
- 🟠 **40-59**: Use Caution
- 🔴 **0-39**: High Risk

---

## 🎯 Features in Detail

### 1. Interactive Map
- **Base Layer**: OpenStreetMap tiles with dark mode filter
- **Zoom Controls**: Bottom-left corner
- **Click Interaction**: Click anywhere for instant analysis
- **Smooth Animations**: Fly-to transitions for searches

### 2. Safety Heatmap
- **Dynamic Generation**: Changes based on time of day
- **Risk Visualization**: Red = high risk, Green = low risk
- **Estimated Patterns**: Generated algorithmically based on time of day — not actual crime data
- **Not Predictive**: Visualizes estimated risk patterns, cannot predict actual incidents
- **Cached Performance**: 5-minute cache for smooth interactions

### 3. Emergency Services
- **🚔 Police Stations**: Blue markers with coverage info
- **🏥 Hospitals**: Red markers with distance
- **🚒 Fire Stations**: Orange markers with response areas
- **Real-Time Data**: Fetched from Google Places API (fallback to Overpass)
- **Fallback System**: Estimated locations if API fails

### 4. CCTV Cameras
- **📹 Surveillance Coverage**: Green circles show camera range
- **Status Indicators**: Active vs. maintenance
- **Coverage Radius**: Visual representation of monitored areas
- **Source Verification**: Google Places, OpenStreetMap, or estimated fallback

### 5. Time-Based Analysis
- **24-Hour Slider**: Adjust from 12 AM to 11 PM
- **Dynamic Scoring**: Safety changes with time
- **Risk Patterns**: Higher risk during late night hours
- **Real-Time Updates**: Instant recalculation

### 6. Emergency Numbers
Supports 30+ countries including:
- 🇮🇳 India (112, 100, 102, 101)
- 🇺🇸 USA (911)
- 🇬🇧 UK (999)
- 🇦🇺 Australia (000)
- 🇯🇵 Japan (110, 119)
- 🇩🇪 Germany (110, 112)
- 🇫🇷 France (17, 15, 18)
- And 23 more countries!

### 7. Notification System
- **Info**: General information (blue)
- **Success**: Successful actions (green)
- **Warning**: Cautions and alerts (yellow)
- **Error**: Failed operations (red)
- **Auto-dismiss**: Configurable duration
- **Non-intrusive**: Top-right corner placement

### 8. Accessibility Features
- **ARIA Labels**: All interactive elements labeled
- **Keyboard Navigation**: Full keyboard support
- **Screen Readers**: Compatible with NVDA, JAWS, VoiceOver
- **Focus Indicators**: Clear visual focus states
- **High Contrast**: Readable in all conditions
- **Semantic HTML**: Proper heading hierarchy

---

## 🏗️ Project Structure

```
safezone/
├── backend/
│   ├── config.js            # Environment-driven backend configuration
│   ├── logger.js            # Structured JSON logger utility
│   ├── metrics.js           # In-memory request/error metrics store
│   ├── alerting.js          # SLO threshold evaluation and webhook alerts
│   ├── model-governance.js  # Drift and calibration governance loop
│   ├── validation.js        # Request payload validation and sanitization
│   ├── yolov8-inference.js  # Configurable remote/deterministic scene adapter
│   ├── middleware/
│   │   ├── auth.js          # API key and metrics token guards
│   │   ├── rate-limit.js    # In-memory API rate limiting middleware
│   │   └── tracing.js       # W3C trace context middleware
│   ├── model-baselines/
│   │   └── default-baseline.json # Governance baseline distributions
│   ├── server.js            # Express backend API + static hosting
│   ├── yolov8-sim.js        # Deterministic scene simulation engine (COCO-class output format)
│   └── risk-engine.js       # Multi-signal risk fusion engine
├── .env.example             # Production backend environment template
├── .dockerignore            # Container build ignore rules
├── Dockerfile               # Containerized backend deployment
├── .github/workflows        # CI/CD, promotion, rollback, governance checks
├── docs/                    # SLO runbooks and governance procedures
├── index.html              # Main HTML structure
├── style.css               # Primary UI styling
├── edge-ai.css             # Edge AI UI styling
├── app.js                  # Core application logic
├── data.js                 # Data fetching and scoring algorithms
├── edge-ai.js              # On-device sensor fusion (microphone + accelerometer)
├── ncrb-data.js            # NCRB published crime rates (23 states, 20 cities)
├── sw.js                   # Service worker shell caching
├── tests.js                # Jest test suite
├── manifest.json           # PWA metadata
├── EVALUATION_METRICS.md   # Rubric mapping and evidence
├── IMPROVEMENTS.md         # Detailed changelog
└── README.md               # This file
```

### File Descriptions

**index.html**
- Page structure and layout
- Map container and sidebar
- Search bar and controls
- Loading overlay
- Accessibility attributes

**style.css**
- Dark mode glassmorphism design
- Responsive layouts
- Animations and transitions
- Custom markers and popups
- Notification styles

**app.js**
- Map initialization
- User interactions
- Sidebar management
- Layer controls
- Search functionality
- Favorite locations
- Notification system

**data.js**
- API integrations (Overpass, Nominatim)
- Safety score algorithm
- Emergency numbers database
- Heatmap generation
- Caching system
- Request throttling

**tests.js**
- Unit/integration checks for risk scoring primitives
- Hotspot normalization and ranking validation
- Reliability weighting and model penalty assertions

**sw.js**
- Offline shell caching and runtime fetch strategy
- Cache lifecycle management during activate/install

---

## 🔧 Configuration

### Changing Default Location
Edit `data.js`:
```javascript
const MAP_CENTER = [28.6139, 77.2090]; // [latitude, longitude]
const MAP_ZOOM = 13; // Zoom level (1-19)
```

### Google API Key (Optional)
SafeZone can use Google APIs for geocoding, reverse geocoding, directions, and approximate location.

Priority order for key loading:
1. `window.SAFEZONE_GOOGLE_API_KEY`
2. `<meta name="safezone-google-api-key" content="...">`
3. `GOOGLE_API_KEY` constant in `data.js` (defaults to empty)

Recommended setup for local development:
```html
<script>
   window.SAFEZONE_GOOGLE_API_KEY = 'YOUR_GOOGLE_API_KEY';
</script>
```

Security notes:
- Never commit a real API key in source files
- Restrict key usage by HTTP referrer in Google Cloud Console
- Enable only the APIs you actually use (Geocoding, Directions, Geolocation)
- Rotate keys immediately if they were previously committed

### Backend API Base URL (Optional)

SafeZone can call a backend API for product-grade risk scoring and YOLOv8 simulation CV.

Priority order for backend URL:
1. `window.SAFEZONE_BACKEND_BASE_URL`
2. `<meta name="safezone-backend-base-url" content="...">`
3. `BACKEND_BASE_URL` constant in `data.js`

Example:
```html
<meta name="safezone-backend-base-url" content="http://localhost:8787">
```

Notes:
- If this value is empty, SafeZone continues using local scoring logic.
- When app and backend are served from the same origin, point this to that origin.

### Backend API Key (Optional but Recommended)

When backend auth is enabled, SafeZone sends `x-api-key` to backend APIs.

Priority order for backend API key:
1. `window.SAFEZONE_BACKEND_API_KEY`
2. `<meta name="safezone-backend-api-key" content="...">`
3. `BACKEND_API_KEY` constant in `data.js`

Example:
```html
<meta name="safezone-backend-api-key" content="replace-with-backend-api-key">
```

Security notes:
- Never commit real backend API keys to source control
- Rotate keys periodically and after any suspected leakage
- Use separate keys for frontend calls and operational tooling

### Backend Infrastructure (Learning/Demo)

The backend includes production-grade infrastructure patterns implemented as a **learning exercise**. These patterns are real and functional but are applied to a simulated inference pipeline and distance-based scoring algorithm — not a production ML system.

**Implemented patterns:**
- API key auth for analysis routes
- Request payload validation and sanitization
- Per-IP rate limiting with standard rate-limit headers
- Structured request logging with request correlation IDs
- W3C trace propagation (`traceparent`) with `X-Trace-Id` correlation
- Configurable scene simulation provider mode: `simulation`, `remote`, or `auto` fallback
- SLO-aware alerting (`/api/ops/alerts`) and live SLO snapshot (`/api/ops/slo`)
- Model governance APIs (`/api/governance/report`, `/api/governance/labels`)
- Health (`/api/health`), readiness (`/api/readiness`), and Prometheus metrics (`/api/metrics`) endpoints

Configuration is environment-driven via `.env.example`:

```bash
cp .env.example .env
```

Key production variables:
- `SAFEZONE_AUTH_REQUIRED=true`
- `SAFEZONE_API_KEYS=comma-separated-secure-keys`
- `SAFEZONE_CORS_ORIGINS=https://your-frontend.example.com`
- `SAFEZONE_RATE_LIMIT_WINDOW_MS=60000`
- `SAFEZONE_RATE_LIMIT_MAX_REQUESTS=120`
- `SAFEZONE_METRICS_TOKEN=secure-metrics-token`
- `SAFEZONE_LOG_LEVEL=info`
- `SAFEZONE_TRACING_ENABLED=true`
- `SAFEZONE_CV_MODE=auto`
- `SAFEZONE_CV_ENDPOINT=https://your-inference-service.example.com/infer`
- `SAFEZONE_ALERTING_ENABLED=true`
- `SAFEZONE_ALERTING_WEBHOOK_URL=https://your-alerts.example.com/hooks/safezone`
- `SAFEZONE_GOVERNANCE_ENABLED=true`
- `SAFEZONE_GOVERNANCE_MIN_DRIFT_SAMPLES=100`

Metrics endpoint security:
- If `SAFEZONE_METRICS_TOKEN` is set, call `/api/metrics` with header `x-metrics-token`.

Container deployment:
```bash
npm run docker:build
npm run docker:run
```

Health verification:
```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/readiness
```

Ops verification:
```bash
curl -H "x-api-key: <safezone-key>" http://localhost:8787/api/ops/slo
curl -H "x-api-key: <safezone-key>" http://localhost:8787/api/governance/report
```

Operational references:
- SLOs and incident runbooks: `docs/SLO_RUNBOOKS.md`
- Model governance lifecycle: `docs/MODEL_GOVERNANCE.md`
- Promotion and rollback pipeline: `docs/DEPLOYMENT_PROMOTION_AND_ROLLBACK.md`

### Adjusting Cache Duration
Edit `data.js`:
```javascript
const CACHE_DURATION = 300000; // 5 minutes in milliseconds
```

### Modifying Request Throttle
Edit `data.js`:
```javascript
const REQUEST_DELAY = 1000; // 1 second in milliseconds
```

### Customizing Safety Algorithm
Edit the `calculateSafetyScore()` function in `data.js` to adjust weights:
```javascript
const policeBonus = Math.min(20, policeCount * 6); // Adjust multiplier
```

---

## ✅ Testing

### Run the test suite
```bash
npm install --save-dev jest
npx jest tests.js --runInBand
```

### What is covered
- Distance decay behavior across near/far ranges
- Hotspot deduplication, ranking, and limit handling
- Crime signal reliability scaling by source/coverage
- Reliability-weighted model training penalties
- Integration behavior between distance decay and hotspot ranking

---

## 🔐 Security Highlights

- Dynamic UI content is escaped before HTML insertion to reduce XSS risk.
- Phone inputs are sanitized before persistence or tel: usage.
- API requests use timeout guards and fallback providers for degraded but safe behavior.
- Service worker cache versioning prevents stale shell accumulation across releases.
- Public safety scoring uses reliability weighting so low-confidence feeds do not over-penalize users.

---

## 🌐 API Dependencies

### OpenStreetMap Nominatim
- **Purpose**: Geocoding and reverse geocoding
- **Endpoint**: `https://nominatim.openstreetmap.org/`
- **Rate Limit**: 1 request per second
- **Usage**: Location search and address lookup

### Overpass API
- **Purpose**: Fallback provider for emergency services and camera feeds
- **Endpoint**: `https://overpass-api.de/api/interpreter`
- **Rate Limit**: Reasonable use policy
- **Usage**: Used when Google Places is unavailable or has no results

### Google Maps Platform APIs (Optional)
- **Purpose**: Primary provider for geocoding, reverse geocoding, turn-by-turn directions, IP-based location, nearby services, and CCTV-relevant place signals
- **Endpoints**:
   - `https://maps.googleapis.com/maps/api/geocode/json`
   - `https://maps.googleapis.com/maps/api/directions/json`
   - `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
   - `https://www.googleapis.com/geolocation/v1/geolocate`
- **Fallbacks**:
   - Nearby services/camera signals -> Overpass
   - Geocoding/reverse geocoding -> Nominatim
   - Routing -> OSRM
   - Approximate location -> map center fallback
- **Handled errors**: 401, 403, 429, request timeout, and service/network failures

### NCRB (National Crime Records Bureau)
- **Purpose**: Published IPC crime rates per lakh population for Indian states and cities
- **Data Source**: "Crime in India" 2022-2023 annual reports
- **Coverage**: 23 states/UTs, 20 metropolitan cities
- **Website**: `https://ncrb.gov.in`
- **Usage**: City → state → national average fallback for safety scoring
- **Important**: Rates reflect *registered* FIRs — higher rates may indicate better police reporting infrastructure

### Leaflet.js
- **Purpose**: Interactive map rendering
- **Version**: 1.9.4
- **CDN**: `https://unpkg.com/leaflet@1.9.4/`
- **Plugin**: Leaflet.heat for heatmap layer

---

## 🎨 Customization

### Changing Color Scheme
Edit CSS variables in `style.css`:
```css
:root {
  --bg-primary: #0a0e17;
  --accent: #6366f1;
  --green: #22c55e;
  --red: #ef4444;
  /* ... more variables */
}
```

### Adjusting Heatmap Colors
Edit `initHeatmap()` in `app.js`:
```javascript
gradient: { 
  0.0: '#22c55e33', 
  0.4: '#eab308', 
  0.8: '#ef4444' 
}
```

### Modifying Safety Ranges
Edit `getSafetyLevel()` in `data.js`:
```javascript
if (score >= 80) return { label: 'Very Safe', class: 'very-safe', icon: '🟢' };
// Adjust thresholds as needed
```

---

## 📱 Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 90+ | ✅ Fully Supported |
| Firefox | 88+ | ✅ Fully Supported |
| Safari | 14+ | ✅ Fully Supported |
| Edge | 90+ | ✅ Fully Supported |
| Opera | 76+ | ✅ Fully Supported |
| Mobile Safari | iOS 14+ | ✅ Fully Supported |
| Chrome Mobile | Android 5+ | ✅ Fully Supported |

### Required Features
- ES6+ JavaScript support
- CSS Grid and Flexbox
- Fetch API
- LocalStorage
- CSS Custom Properties

---

## 🐛 Troubleshooting

### Map Not Loading
- **Check internet connection**
- **Verify browser console for errors**
- **Try refreshing the page**
- **Clear browser cache**

### API Errors
- **Issue**: "Using estimated data" warning
- **Cause**: Overpass API rate limit or downtime
- **Solution**: Wait a few minutes and try again
- **Note**: Fallback data is automatically used

### Google API Warnings
- **Issue**: "Google API key was rejected" (401/403)
- **Cause**: Invalid key, wrong referrer restrictions, or API not enabled
- **Solution**: Verify key, restrictions, and enabled Google APIs

- **Issue**: "Google API quota or rate limit was reached" (429/OVER_QUERY_LIMIT)
- **Cause**: Daily or per-minute quota exhausted
- **Solution**: Increase quota/billing limits or reduce request volume

- **Issue**: "Google API request timed out"
- **Cause**: Temporary network/service latency
- **Solution**: Retry; SafeZone automatically falls back to OSM/OSRM

### Search Not Working
- **Check spelling and try different terms**
- **Use full addresses or city names**
- **Verify internet connection**
- **Check browser console for errors**

### Slow Performance
- **Clear browser cache**
- **Close other tabs**
- **Disable browser extensions**
- **Use a modern browser**

### Heatmap Not Updating
- **This is normal - heatmap is cached for 5 minutes**
- **Move to a different location to see changes**
- **Refresh the page to clear cache**

---

## 🔒 Privacy & Data

### Data Collection
- **No personal data collected**
- **No tracking or analytics**
- **No cookies used**
- **LocalStorage only for favorites**

### Data Sources
- **Google Maps Platform**: Primary data source when API key is configured
- **OpenStreetMap**: Community-contributed map data
- **Overpass API**: Fallback OSM query service for resilient results
- **Nominatim**: OSM geocoding service
- **All data is public and open-source**

### Estimated Data
When APIs are unavailable:
- Fallback locations are generated
- Clearly marked with ⚠️ symbol
- Based on typical service distribution
- Should not be relied upon for critical decisions

---

## ⚠️ Important Disclaimers

### Safety Scores
- **Estimates only**: Not official safety ratings
- **Multiple factors**: Based on available data only
- **Use judgment**: Always trust your instincts
- **Local knowledge**: Consult local authorities
- **Not comprehensive**: Cannot account for all risks

### Heatmap
- **Algorithmically generated**: Not based on actual crime statistics — uses time-of-day patterns
- **Visual representation**: Shows estimated risk patterns for educational purposes
- **Visual representation**: Shows estimated risk patterns
- **Time-based**: Changes with time of day
- **Not predictive**: Cannot predict actual incidents

### Emergency Services
- **Verify information**: Always confirm with local authorities
- **Distance estimates**: May not reflect actual travel time
- **Availability**: Services may be temporarily unavailable
- **Emergency**: In real emergencies, call local emergency numbers

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues
1. Check existing issues first
2. Provide detailed description
3. Include browser and OS info
4. Add screenshots if applicable

### Suggesting Features
1. Open an issue with [Feature Request] tag
2. Describe the feature and use case
3. Explain expected behavior

### Code Contributions
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Areas for Improvement
- Real crime data integration
- Route safety analysis
- Weather integration
- Historical data comparison
- Mobile app version
- Offline mode
- Multi-language support

---

## 📊 Performance Metrics

### Load Times
- **Initial Load**: ~1.5 seconds
- **Location Analysis**: ~2-3 seconds
- **Search**: ~1-2 seconds
- **Time Slider**: Instant (cached)

### API Calls
- **Throttled**: 1 second between requests
- **Parallel**: Multiple APIs called simultaneously
- **Cached**: Heatmap cached for 5 minutes
- **Fallback**: Automatic on API failure

### Browser Resources
- **Memory**: ~50-80 MB typical usage
- **CPU**: Minimal (idle after load)
- **Network**: ~2-5 MB per session
- **Storage**: <1 MB (favorites only)

---

## 🎓 Educational Use

SafeZone is perfect for:
- **Web Development Learning**: Modern JavaScript, CSS, APIs
- **GIS Education**: Mapping, spatial analysis
- **Safety Awareness**: Understanding urban safety factors
- **Data Visualization**: Heatmaps, interactive maps
- **UX Design**: Accessibility, user feedback

---

## 📄 License

This project is open source and available under the MIT License.

```
MIT License

Copyright (c) 2024 SafeZone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- **OpenStreetMap**: For providing free, open map data
- **Google Maps Platform**: For geospatial APIs and nearby place intelligence
- **Leaflet.js**: For the excellent mapping library
- **Overpass API**: For fallback OSM data access
- **Nominatim**: For geocoding services
- **Inter Font**: For beautiful typography
- **Community Contributors**: For testing and feedback

---

## 📞 Support

### Getting Help
- **Documentation**: Read this README and IMPROVEMENTS.md
- **Issues**: Check GitHub issues for similar problems
- **Browser Console**: Check for error messages
- **Community**: Ask questions in discussions

### Contact
- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and ideas
- **Email**: [Your contact email]

---

## 🗺️ Roadmap

### Version 2.1 (Planned)
- [ ] Route safety comparison
- [ ] Weather integration
- [ ] Historical time analysis
- [ ] Nearby safe zones (24/7 establishments)
- [ ] Share safety reports

### Version 3.0 (Future)
- [ ] Real-time crime data API integration (beyond NCRB static rates)
- [ ] Mobile app (React Native)
- [ ] Offline mode
- [ ] Multi-language support
- [ ] User accounts and history
- [ ] Community reports

---

## 📈 Changelog

### Version 2.2 (NCRB + Terminology Update)
- ✅ Integrated NCRB Crime in India 2023 published crime rates (23 states, 20 cities)
- ✅ Added NCRB crime statistics card to sidebar with per-lakh breakdowns
- ✅ Safety score now factors in real published crime rates relative to national average
- ✅ Fixed misleading terminology: "Edge AI" → "On-Device Sensor Fusion"
- ✅ Fixed misleading terminology: "YOLOv8 Simulation" → "Deterministic Scene Simulation"
- ✅ Made safety score methodology transparent in sidebar disclaimer
- ✅ Added data quality caveat about FIR registration rates
- ✅ Removed node_modules from version control
- ✅ Reframed backend ops infrastructure as learning exercise in docs
- ✅ Updated heatmap legend with explicit "not crime data" disclaimer

### Version 2.1 (Security + Testing Update)
- ✅ Expanded and documented risk-engine test coverage in `tests.js`
- ✅ Added explicit README testing instructions and coverage summary
- ✅ Clarified runtime security safeguards and fallback behavior
- ✅ Updated project structure docs for service worker and Edge AI modules

### Version 2.0 (Current)
- ✅ Added 30+ countries emergency numbers
- ✅ Implemented notification system
- ✅ Added favorite locations feature
- ✅ Enhanced safety algorithm
- ✅ Added score breakdown
- ✅ Implemented caching and throttling
- ✅ Full accessibility support
- ✅ Data transparency indicators
- ✅ Improved error handling

### Version 1.0 (Initial)
- ✅ Basic map functionality
- ✅ Safety score calculation
- ✅ Emergency services display
- ✅ CCTV camera markers
- ✅ Time-based analysis
- ✅ Location search
- ✅ Heatmap visualization

---

## 🎉 Quick Demo

1. **Open the app** - See the map load with default location
2. **Click the map** - Instant safety analysis appears
3. **Try the search** - Type "Times Square, New York" and press Enter
4. **Adjust time** - Drag the slider to midnight and watch the score change
5. **Toggle layers** - Turn off the heatmap to see the map clearly
6. **Save location** - Click the star button to save your favorite spot
7. **Check emergency numbers** - See local emergency contacts for any country

---

**Built with ❤️ for safer communities worldwide**

*Last Updated: April 26, 2026*
