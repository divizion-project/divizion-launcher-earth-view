import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

// --- Configuration ---
const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhYjNmNjVkMC04YTBhLTRmNWMtODdjMS05NGUxZDI4OGQzM2EiLCJpZCI6MzYzNDE1LCJpYXQiOjE3NjQwMTI3MjN9.u78rjI-bmc4uWEGANSorM9NheilGCPsthv68efxV1MY';
Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

// --- Overlay Setup ---
const warpOverlay = document.getElementById('warp-overlay') as HTMLDivElement;
if (warpOverlay) {
  warpOverlay.style.background = 'black';
  warpOverlay.style.opacity = '1';
  warpOverlay.style.display = 'block';
  warpOverlay.style.zIndex = '9999'; // Ensure it's on top
}

// --- Cesium Setup ---
const viewer = new Cesium.Viewer('cesiumContainer', {
  animation: false,
  baseLayerPicker: false,
  fullscreenButton: false,
  vrButton: false,
  geocoder: false,
  homeButton: false,
  infoBox: false,
  sceneModePicker: false,
  selectionIndicator: false,
  timeline: false,
  navigationHelpButton: false,
  navigationInstructionsInitiallyVisible: false,
  skyAtmosphere: new Cesium.SkyAtmosphere(),
  globe: new Cesium.Globe(Cesium.Ellipsoid.WGS84),
});

// Remove credit
(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

// Enable lighting and smoother atmosphere
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.atmosphereBrightnessShift = 0.0; // Reset to natural
if (viewer.scene.skyAtmosphere) {
  viewer.scene.skyAtmosphere.saturationShift = 0.0;
  viewer.scene.skyAtmosphere.brightnessShift = 0.0;
}
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.0001; // Lighter fog
viewer.scene.globe.showGroundAtmosphere = true;

// Add 3D Buildings (Google Photorealistic 3D Tiles)
let googleTileset: Cesium.Cesium3DTileset | null = null;
let osmBuildingsTileset: Cesium.Cesium3DTileset | null = null;

try {
  Cesium.createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true // Suppress warning as we're not using geocoding
  }).then(tileset => {
    googleTileset = tileset;
    viewer.scene.primitives.add(tileset);
    tileset.show = false; // Hide initially to see Globe's night lights from space
  });
} catch (e) {
  console.warn("Google Photorealistic 3D Tiles not supported or failed, falling back to OSM", e);
  Cesium.createOsmBuildingsAsync().then(buildings => {
    osmBuildingsTileset = buildings;
    viewer.scene.primitives.add(buildings);
    buildings.show = false;
  });
}

// Toggle buildings based on altitude (50km)
viewer.scene.postRender.addEventListener(() => {
  const height = viewer.camera.positionCartographic.height;
  const showBuildings = height < 50000;
  if (googleTileset) googleTileset.show = showBuildings;
  if (osmBuildingsTileset) osmBuildingsTileset.show = showBuildings;
});

// Ensure time is set to now for correct day/night lighting
viewer.clock.currentTime = Cesium.JulianDate.now();

// High quality settings
viewer.scene.highDynamicRange = true;
viewer.scene.postProcessStages.fxaa.enabled = true;

// --- Visual Enhancements ---

// 1. Darken Base Layer for better contrast and night feel
const baseLayer = viewer.imageryLayers.get(0);
if (baseLayer) {
  baseLayer.brightness = 0.6; // Darker ground
}




// Random Initial Position
const initialLon = Math.random() * 360 - 180;
const initialLat = Math.random() * 180 - 90;

// User Location (Global)
let userLocation: Location | null = null;

// Initial Camera Position (2,000,000 km)

viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(initialLon, initialLat, 2000000000), // 2 million km
  orientation: {
    heading: 0.0,
    pitch: Cesium.Math.toRadians(-90.0),
    roll: 0.0
  }
});

// --- Sequence Logic ---

async function startSequence() {
  // 1. Fade In
  await new Promise(r => setTimeout(r, 500));

  if (warpOverlay) {
    warpOverlay.style.transition = 'opacity 3s ease-in-out';
    warpOverlay.style.opacity = '0';
    setTimeout(() => { warpOverlay.style.display = 'none'; }, 3000);
  }

  // 2. Fetch Location
  userLocation = await fetchUserLocation() || { lat: 48.8566, lon: 2.3522 };

  // 3. Approach Phase
  // Fly from 2M km to 20,000 km (Orbit view)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(initialLon, initialLat, 20000000), // 20,000 km
    duration: 10.0,
    easingFunction: Cesium.EasingFunction.QUINTIC_OUT,
    complete: () => {
      if (userLocation) startSpiralZoom(userLocation);
    }
  });
}

function startSpiralZoom(targetLoc: Location) {
  const startPos = viewer.camera.positionCartographic;
  const startLon = startPos.longitude;
  const startLat = startPos.latitude;
  const startHeight = startPos.height;
  const startPitch = viewer.camera.pitch;
  const startHeading = viewer.camera.heading;

  // Target: 200km altitude, Tilted North
  const targetLonRad = Cesium.Math.toRadians(targetLoc.lon);

  // Offset target latitude South so looking North centers the target
  // At 5,000km height, we need a large offset to see the target at -50 deg pitch.
  // tan(40deg) * 5000km = ~4200km offset = ~38 degrees.
  const CAMERA_OFFSET_SOUTH = 38.0; // Degrees
  const targetLatRad = Cesium.Math.toRadians(targetLoc.lat - CAMERA_OFFSET_SOUTH);

  const targetHeight = 8000000; // 200 km
  const targetPitch = Cesium.Math.toRadians(-60); // Tilted view
  const targetHeading = 0; // North

  // Calculate delta longitude for spiral
  let deltaLon = targetLonRad - startLon;

  // Normalize to [-2PI, 0] for Left rotation
  while (deltaLon > 0) deltaLon -= Cesium.Math.TWO_PI;
  while (deltaLon <= -Cesium.Math.TWO_PI) deltaLon += Cesium.Math.TWO_PI;

  // Add 1 full rotation for spiral effect
  deltaLon -= Cesium.Math.TWO_PI;

  // Shortest path for Heading
  let deltaHeading = targetHeading - startHeading;
  while (deltaHeading > Math.PI) deltaHeading -= Cesium.Math.TWO_PI;
  while (deltaHeading < -Math.PI) deltaHeading += Cesium.Math.TWO_PI;

  const duration = 10.0; // 10 seconds spiral
  const startTime = performance.now();

  const zoomTick = () => {
    const now = performance.now();
    const t = Math.min((now - startTime) / (duration * 1000), 1.0);

    // Smooth easing (Start slow, accelerate, slow down)
    const ease = Cesium.EasingFunction.QUINTIC_IN_OUT(t);

    const currLon = startLon + deltaLon * ease;
    const currLat = Cesium.Math.lerp(startLat, targetLatRad, ease);
    const currHeight = Cesium.Math.lerp(startHeight, targetHeight, ease);
    const currPitch = Cesium.Math.lerp(startPitch, targetPitch, ease);
    const currHeading = startHeading + deltaHeading * ease;

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(currLon, currLat, currHeight),
      orientation: {
        heading: currHeading,
        pitch: currPitch,
        roll: 0.0
      }
    });

    // 3D tiles visibility is handled by postRender listener

    if (t >= 1.0) {
      viewer.clock.onTick.removeEventListener(zoomTick);
      addLocationMarker(targetLoc);
    }
  };

  viewer.clock.onTick.addEventListener(zoomTick);
}

function addLocationMarker(loc: Location) {
  // "Apple-style" pulsing effect (3D ripples, no central point)
  const waveCount = 3;
  const duration = 3000; // ms
  const maxRadius = 400000.0; // 400 km
  const baseColor = Cesium.Color.fromCssColorString('#007AFF'); // Apple Blue
  const markerStartTime = performance.now();

  for (let i = 0; i < waveCount; i++) {
    const offset = (duration / waveCount) * i;

    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty((_time) => {
          const now = performance.now();
          let t = ((now + offset) % duration) / duration;
          // Ease out for expansion
          t = 1 - Math.pow(1 - t, 3);
          return Math.max(1.0, maxRadius * t); // Avoid 0
        }, false),
        semiMajorAxis: new Cesium.CallbackProperty((_time) => {
          const now = performance.now();
          let t = ((now + offset) % duration) / duration;
          t = 1 - Math.pow(1 - t, 3);
          // Ensure strictly greater with a safe margin (100m) to prevent crash
          return Math.max(1.0, maxRadius * t) + 100.0;
        }, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty((_time) => {
          const now = performance.now();

          // Appearance animation: Fade in over 2 seconds
          const appearanceDuration = 2000;
          const appearanceProgress = Math.min((now - markerStartTime) / appearanceDuration, 1.0);

          let t = ((now + offset) % duration) / duration;
          // Fade out: starts at 0.3 (more discrete), goes to 0
          const alpha = 0.3 * (1.0 - t) * appearanceProgress;
          return baseColor.withAlpha(alpha);
        }, false)),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      }
    });
  }
}

interface Location {
  lat: number;
  lon: number;
}

async function fetchUserLocation(): Promise<Location | null> {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();
    if (data.latitude && data.longitude) {
      return { lat: data.latitude, lon: data.longitude };
    }
    return null;
  } catch (e) {
    console.error("Failed to fetch location", e);
    return null;
  }
}

// Start
startSequence();

// --- Hash Navigation ---

window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash === '#settings') {
    animateToSettings();
  } else if (hash === '#play') {
    animateToPlay();
  } else if (hash === '#base') {
    animateToBase();
  }
});

function animateToBase() {
  // Ensure overlay is hidden
  if (warpOverlay) {
    warpOverlay.style.opacity = '0';
    setTimeout(() => { warpOverlay.style.display = 'none'; }, 500);
  }

  // Return to the "Spiral Zoom" end state
  // Target: 8,000km altitude, Tilted North, Offset South

  const targetLoc = userLocation || { lat: 48.8566, lon: 2.3522 }; // Default to Paris if null

  const CAMERA_OFFSET_SOUTH = 38.0; // Degrees
  const targetLat = targetLoc.lat - CAMERA_OFFSET_SOUTH;
  const targetLon = targetLoc.lon;
  const targetHeight = 8000000; // Matches startSpiralZoom target

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      targetLon,
      targetLat,
      targetHeight
    ),
    orientation: {
      heading: 0.0, // North
      pitch: Cesium.Math.toRadians(-60.0), // Tilted view
      roll: 0.0
    },
    duration: 2.0,
    easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT
  });
}

function animateToSettings() {
  // Ensure overlay is hidden
  if (warpOverlay) {
    warpOverlay.style.opacity = '0';
    setTimeout(() => { warpOverlay.style.display = 'none'; }, 500);
  }

  // Fly to high altitude
  // To put Earth on the Left:
  // 1. Look East (Heading 90)
  // 2. Look somewhat Down (Pitch -60). Nadir is "Below" view.
  // 3. Roll -90 deg (CW). "Below" becomes "Left".
  const currentPos = viewer.camera.positionCartographic;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(
      currentPos.longitude,
      currentPos.latitude,
      12000000 // 12,000 km viewing distance (Zoomed in)
    ),
    orientation: {
      heading: Cesium.Math.toRadians(90),
      pitch: Cesium.Math.toRadians(-60),
      roll: Cesium.Math.toRadians(-90)
    },
    duration: 2.0,
    easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT
  });
}

function animateToPlay() {
  if (!userLocation) return;

  // 1. Fade to black
  if (warpOverlay) {
    warpOverlay.style.display = 'block';
    warpOverlay.style.opacity = '0'; // Ensure it starts transparent

    // Use setTimeout to allow the browser to register the 'display: block' and 'opacity: 0' state
    // before applying the transition to 'opacity: 1'.
    setTimeout(() => {
      warpOverlay.style.transition = 'opacity 12.0s ease-out'; // Slightly longer/smoother
      warpOverlay.style.opacity = '1';
    }, 50);
  }

  // 2. Cinematic Zoom to Ground
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      userLocation.lon,
      userLocation.lat,
      1000 // 1km altitude (very close)
    ),
    orientation: {
      heading: viewer.camera.heading, // Keep current heading or spin?
      pitch: Cesium.Math.toRadians(-20), // Look at horizon/ground
      roll: 0.0
    },
    duration: 10.0, // Animation is longer than fade (3.0s)
    easingFunction: Cesium.EasingFunction.EXPONENTIAL_IN,
  });
}
