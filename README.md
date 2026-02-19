# ☀️ SOLAR STATION

**Solar Station** is a lightweight, high-performance, self-hosted space weather dashboard. It continuously aggregates, processes, and caches real-time solar data from NASA, NOAA, and the SWPC (Space Weather Prediction Center) to provide a comprehensive view of current solar activity, geomagnetic conditions, and flare threats. 

Built with Node.js and Express, it features a background cron-worker that fetches imagery, renders MP4 animations of solar phenomena on-the-fly using FFmpeg, and serves a blazing-fast, cache-friendly UI to the browser.

---

## 🚀 Features

* **Real-Time Telemetry Dashboard:** View current X-Ray flux, Planetary K-Index, Aurora Forecasts, and Solar Wind data at a glance.
* **Live SDO & SOHO Feeds:** Automatically downloads and loops the latest imagery and videos from the Solar Dynamics Observatory (SDO) and the LASCO Coronagraphs. It downloads various resolutions chosen for performance/speed.
* **Auto-Rendered Animations:** Uses FFmpeg to automatically stitch hundreds of raw NOAA frames into smooth, playable MP4 videos for:
  * WSA-ENLIL Solar Wind Predictions
  * D-RAP (D-Region Absorption Predictions) Global Ionosphere Maps
  * GOES-19 CCOR-1 Coronagraphs
  * Active Solar Flare Regions
* **STEREO-A Beacon Integration:** Pulls the latest low-res telemetry from the STEREO-A spacecraft to monitor the far side of the sun.
* **CME Event Catalog (DONKI):** Connects to NASA's Space Weather Database Of Notifications, Knowledge, Information (DONKI) API to display a logged history of recent Coronal Mass Ejections.
* **Bandwidth Friendly:** Implements smart `meta.json` fingerprinting to allow the browser to aggressively cache massive video files, updating only when the server generates a new file.

---

## 🛠 Prerequisites

Before installing, ensure you have the following installed on your system:

* **Node.js** (v18.0 or higher recommended)
* **npm** (comes with Node.js)

*Note: You do not need FFmpeg installed globally on your OS. The app uses the `@ffmpeg-installer/ffmpeg` package to handle the binaries automatically.*

---

## ⚙️ Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YOUR_USERNAME/solar-station.git](https://github.com/YOUR_USERNAME/solar-station.git)
   cd solar-station
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your NASA API Key:**
   To pull the CME Event Catalog, this app uses the NASA DONKI API. By default, the app is set to use `DEMO_KEY`. However, the demo key has strict rate limits (only 30 requests per IP address per hour). To ensure stable background syncing, you should get your own free key:
   * Go to **[api.nasa.gov](https://api.nasa.gov/)**.
   * Fill out the form with your First Name, Last Name, and Email, then click **Signup**.
   * NASA will immediately display and email you your personal API Key.
   * Open `server.js` (or your main app file) in your project root.
   * Locate the configuration section and replace the API key:
     ```javascript
     // Change this line:
     const API_KEY = 'DEMO_KEY'; 
     
     // To your new key:
     const API_KEY = 'YOUR_NEW_NASA_API_KEY_HERE';
     ```

---

## 💻 Usage

Start the Solar Station server:

```bash
node server.js
```

* **First Boot:** On the very first run, the server will execute a `runFullSync()`. It will take a few minutes to download all base images and render the initial MP4 animations. Please be patient!
* **Access the Dashboard:** Once the console says `Solar Station running on http://localhost:3000`, open your web browser and navigate to:
  👉 `http://localhost:3000`

### Automated Syncing
The app runs completely headless in the background using `node-cron`:
* **Every 10 minutes:** Performs a mini-sync (Updates STEREO-A beacon images and refreshes the metadata).
* **Every 30 minutes:** Performs a full sync (Downloads new SDO/SOHO frames, prunes old data, fetches the CME catalog, and re-renders all MP4 animations).

---

## 📂 Project Structure

```text
solar-station/
├── public/                 # Served by Express
│   ├── index.html          # Main frontend dashboard UI
│   └── cache/              # (Auto-generated) Video renders & downloaded imagery
├── server.js               # Main backend application (Crawlers, FFmpeg, API)
├── package.json            # Node.js dependencies
└── README.md               # You are here
```

---

## ⚠️ Disclaimer & Data Sources
This project relies heavily on the public APIs and open data directories provided by the **National Oceanic and Atmospheric Administration (NOAA)**, the **Space Weather Prediction Center (SWPC)**, and **NASA**. 
* If a specific panel shows "NO DATA," it is highly likely that the upstream NOAA/NASA server is undergoing maintenance or the spacecraft telemetry is delayed.