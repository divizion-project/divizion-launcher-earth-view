import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.161.0/examples/jsm/postprocessing/ShaderPass.js';
import { extractDescriptorFromPath, parseCameraDescriptor } from './camera.js';
import { createStarfieldTexture } from './starfield.js';

const assetPath = relative => new URL(relative, import.meta.url).href;


const QUALITY_LEVELS = {
  low: {
    name: 'Qualité Standard (2K)',
    minFPS: 0,
    targetFPS: 45,
    textures: {
      earthDay: 'standar-def/2k/earth_day.jpg',
      earthSpecular: 'standar-def/2k/earth_specular.png',
      earthNormal: 'standar-def/2k/earth_normal.png',
      earthNight: 'standar-def/2k/earth_night.jpg',
      clouds: 'standar-def/2k/earth_clouds.jpg'
    }
  },
  high: {
    name: 'Qualité Haute (4K)',
    minFPS: 45,
    targetFPS: 999,
    textures: {
      earthDay: 'standar-def/4k/earth_day.jpg',
      earthSpecular: 'standar-def/4k/earth_specular.png',
      earthNormal: 'standar-def/4k/earth_normal.png',
      earthNight: 'standar-def/4k/earth_night.jpg',
      clouds: 'standar-def/4k/earth_clouds.jpg'
    }
  }
};
const TEXTURE_SOURCES = {
  earthDay: [assetPath('../assets/textures/earth_day_5400.jpg'), 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'],
  earthSpecular: [assetPath('../assets/textures/earth_specular_2048.jpg'), 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'],
  earthNormal: [assetPath('../assets/textures/earth_normal_2048.jpg'), 'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg'],
  earthNight: [assetPath('../assets/textures/earth_night_5400.jpg'), 'https://threejs.org/examples/textures/planets/earth_lights_2048.png'],
  clouds: [assetPath('../assets/textures/earth_clouds_2048.png'), 'https://threejs.org/examples/textures/planets/earth_clouds_1024.png']
};

const EARTH_RADIUS = 1;
const CLOUD_OFFSET = 0.01;
const EARTH_ROTATION_SPEED = 0.012;
const CLOUD_ROTATION_SPEED = 0.018;
const TRANSITION_DURATION = 2600;
const CHUNK_CONFIG = {
  latSegments: 12,
  lonSegments: 24,
  maxActive: 18,
  keepAlive: 14000,
  radiusOffset: 0.003,
  lateralNeighborhood: 2,
  verticalNeighborhood: 1
};

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setClearColor(0x000000, 1);
const clock = new THREE.Clock();
let cameraTransition = null;
let statusTimeout = null;
const cameraTarget = new THREE.Vector3(0, 0, 0);
const worldUp = new THREE.Vector3(0, 1, 0);
const sunDirection = new THREE.Vector3();
const sunPositionVector = new THREE.Vector3();
const rotationModes = {
  search: { earth: EARTH_ROTATION_SPEED * 3.5, clouds: CLOUD_ROTATION_SPEED * 3 },
  focusing: { earth: EARTH_ROTATION_SPEED * 1.2, clouds: CLOUD_ROTATION_SPEED * 1.6 },
  locked: { earth: 0, clouds: CLOUD_ROTATION_SPEED * 0.9 },
  free: { earth: EARTH_ROTATION_SPEED, clouds: CLOUD_ROTATION_SPEED * 1.05 }
};
let rotationMode = 'search';
const SUN_DISTANCE = 18;
const JULIAN_UNIX_EPOCH = 2440587.5;
const JULIAN_J2000 = 2451545.0;
const SUN_UPDATE_INTERVAL_MS = 15000;
const cachedSunDirection = new THREE.Vector3(1, 0, 0);
let lastSunCalculation = 0;
const composerResolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
let composer = null;
let bloomPass = null;
let cinematicPass = null;
let earthMaterial = null;
let atmosphereInner = null;
let atmosphereOuter = null;
let sunBillboard = null;

const CINEMATIC_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainAmount: { value: 0.012 },
    saturation: { value: 1.02 },
    contrast: { value: 1.05 },
    lift: { value: new THREE.Vector3(0.008, 0.01, 0.015) },
    gamma: { value: 0.98 },
    vignette: { value: 0.9 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grainAmount;
    uniform float saturation;
    uniform float contrast;
    uniform vec3 lift;
    uniform float gamma;
    uniform float vignette;

    float random(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + time) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 grey = vec3(luma);
      color.rgb = mix(grey, color.rgb, saturation);
      color.rgb = mix(vec3(0.5), color.rgb, contrast);
      color.rgb += lift;
      color.rgb = pow(color.rgb, vec3(gamma));
      float grain = (random(vUv * (time + 1.0)) - 0.5) * grainAmount;
      color.rgb += grain;
      float dist = distance(vUv, vec2(0.5));
      float vig = smoothstep(0.75, vignette, dist);
      color.rgb *= (1.0 - vig * 0.75);
      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }
  `
};

const root = document.querySelector('#scene-root');
root.appendChild(renderer.domElement);

const statusBanner = document.createElement('div');
statusBanner.className = 'status-banner hidden';
root.appendChild(statusBanner);

const loadingLabel = document.createElement('div');
loadingLabel.className = 'loading';
loadingLabel.textContent = 'LOADING';
root.appendChild(loadingLabel);

function showStatus(message, { persist = false } = {}) {
  statusBanner.textContent = message;
  statusBanner.classList.remove('hidden');
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  if (!persist) {
    statusTimeout = setTimeout(() => {
      statusBanner.classList.add('hidden');
    }, 3200);
  }
}

function hideStatus(delay = 0) {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  if (delay > 0) {
    statusTimeout = setTimeout(() => {
      statusBanner.classList.add('hidden');
    }, delay);
  } else {
    statusBanner.classList.add('hidden');
  }
}

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0.25, 3.6);
camera.lookAt(cameraTarget);

const sunTarget = new THREE.Object3D();
sunTarget.position.set(0, 0, 0);
scene.add(sunTarget);

const sun = new THREE.DirectionalLight(0xfff0cf, 4.2);
sun.position.set(-9, 5, 6.5);
sun.target = sunTarget;
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 25;
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0x2e4a80, 0x050505, 0.35);
scene.add(hemi);

const rimLight = new THREE.PointLight(0x3a63ff, 0.55);
rimLight.position.set(3.2, 1.8, -3.5);
scene.add(rimLight);
sunDirection.copy(sun.position).normalize();

const globeGroup = new THREE.Group();
scene.add(globeGroup);
const searchEffects = new THREE.Group();
scene.add(searchEffects);
createSearchEffects();
searchEffects.visible = rotationMode === 'search';
let earthMesh = null;
let cloudsMesh = null;
let starParticles = null;
let markerAnchor = null;
const markerPulseConfig = { anchor: null, lastEmission: 0, interval: 1500 };
const markerPulses = [];
const markerPulseDuration = 1800;
let nightLightsMaterial = null;
let nightLightsMesh = null;
let chunkManager = null;
let chunkStreamingPromise = null;

sunBillboard = createSunBillboard();
scene.add(sunBillboard);
updateSunPosition(true);

const performanceMonitor = {
  fps: [],
  frameCount: 0,
  lastTime: performance.now(),
  currentQuality: 'low',
  isMonitoring: false,
  monitorDuration: 3000,
  monitorStart: 0,
  qualityLocked: false
};

function createStarParticles(count = 1500, radius = 130) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    const r = radius + Math.random() * 20;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const hue = 190 + Math.random() * 80;
    const color = new THREE.Color(`hsl(${hue}, 85%, ${70 + Math.random() * 20}%)`);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.9,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1;
  return points;
}

function createSunBillboardTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 250, 232, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 220, 150, 0.95)');
  gradient.addColorStop(0.7, 'rgba(255, 170, 70, 0.4)');
  gradient.addColorStop(1, 'rgba(255, 140, 50, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSunBillboard() {
  const material = new THREE.SpriteMaterial({
    map: createSunBillboardTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  material.toneMapped = false;
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 5;
  return sprite;
}

function normalizeAngle(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function toJulianDate(date = new Date()) {
  return date.getTime() / 86400000 + JULIAN_UNIX_EPOCH;
}

function computeSubsolarPoint(date = new Date()) {
  const jd = toJulianDate(date);
  const T = (jd - JULIAN_J2000) / 36525;
  const L0 = normalizeAngle(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = normalizeAngle(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const Mrad = THREE.MathUtils.degToRad(M);
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);
  const trueLongitude = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLongitude - 0.00569 - 0.00478 * Math.sin(THREE.MathUtils.degToRad(omega));
  const epsilon0 = 23.439291 - 0.0130042 * T;
  const epsilon = epsilon0 + 0.00256 * Math.cos(THREE.MathUtils.degToRad(omega));
  const lambdaRad = THREE.MathUtils.degToRad(lambda);
  const epsilonRad = THREE.MathUtils.degToRad(epsilon);
  const declination = Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad));
  const y = Math.cos(epsilonRad) * Math.sin(lambdaRad);
  const x = Math.cos(lambdaRad);
  const rightAscension = Math.atan2(y, x);
  const RAdeg = normalizeAngle(THREE.MathUtils.radToDeg(rightAscension));
  const GMST = normalizeAngle(
    280.46061837 +
      360.98564736629 * (jd - JULIAN_J2000) +
      0.000387933 * T * T -
      (T * T * T) / 38710000
  );
  const gha = normalizeAngle(GMST - RAdeg);
  let subLon = -gha;
  if (subLon > 180) {
    subLon -= 360;
  } else if (subLon < -180) {
    subLon += 360;
  }
  return {
    latitude: THREE.MathUtils.radToDeg(declination),
    longitude: subLon
  };
}

function computeSunDirection(date = new Date()) {
  const { latitude, longitude } = computeSubsolarPoint(date);
  return latLonToVector3(latitude, longitude, 1).normalize();
}

function setupPostProcessing() {
  composerResolution.set(window.innerWidth, window.innerHeight);
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(composerResolution.clone(), 0.4, 0.4, 0.6);
  bloomPass.threshold = 0.55;
  bloomPass.strength = 0.45;
  bloomPass.radius = 0.55;
  composer.addPass(bloomPass);

  cinematicPass = new ShaderPass(CINEMATIC_SHADER);
  composer.addPass(cinematicPass);
}

function updateComposerSize() {
  if (!composer) {
    return;
  }
  composerResolution.set(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  bloomPass?.setSize(window.innerWidth, window.innerHeight);
}

function spawnPulse() {
  if (!markerPulseConfig.anchor) {
    return;
  }
  const pulseGeo = new THREE.RingGeometry(0.008, 0.014, 48);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xadf8cf,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
  pulseMesh.position.set(0, 0, 0.0025);
  markerPulseConfig.anchor.add(pulseMesh);
  markerPulses.push({ mesh: pulseMesh, start: performance.now(), duration: markerPulseDuration });
}

function resetMarkerEffects() {
  markerPulses.forEach(pulse => {
    pulse.mesh.parent?.remove(pulse.mesh);
  });
  markerPulses.length = 0;
  if (markerAnchor) {
    globeGroup.remove(markerAnchor);
    markerAnchor = null;
  }
  markerPulseConfig.anchor = null;
}

function updatePulses(now) {
  if (markerPulseConfig.anchor && now - markerPulseConfig.lastEmission >= markerPulseConfig.interval) {
    spawnPulse();
    markerPulseConfig.lastEmission = now;
  }
  for (let i = markerPulses.length - 1; i >= 0; i -= 1) {
    const pulse = markerPulses[i];
    const elapsed = now - pulse.start;
    const t = elapsed / pulse.duration;
    if (t >= 1) {
      pulse.mesh.parent?.remove(pulse.mesh);
      markerPulses.splice(i, 1);
      continue;
    }
    const scale = 1 + t * 2.2;
    pulse.mesh.scale.setScalar(scale);
    pulse.mesh.material.opacity = 0.35 * (1 - t);
  }
}

function createNightLightsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: textures.earthNight },
      sunDirection: { value: sunDirection.clone() },
      intensity: { value: 1.5 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform float intensity;
      void main() {
        float night = clamp(dot(-sunDirection, normalize(vWorldNormal)), 0.0, 1.0);
        vec3 color = texture2D(map, vUv).rgb * night * intensity;
        gl_FragColor = vec4(color, night * 0.9);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });
}

function updateSunUniform() {
  sunDirection.copy(sun.position).normalize();
  // nightLightsMaterial n'est plus utilisé - les lumières de nuit sont dans earthMaterial
  // if (nightLightsMaterial) {
  //   nightLightsMaterial.uniforms.sunDirection.value.copy(sunDirection);
  // }
  const cloudSunUniform = cloudsMesh?.material?.userData?.sunUniform;
  if (cloudSunUniform) {
    cloudSunUniform.value.copy(sunDirection);
  }
  updateEarthShaderUniforms();
  updateAtmosphereUniforms();
  chunkManager?.updateSunDirection(sunDirection);
}

function createSearchEffects() {
  const ringCount = 3;
  for (let i = 0; i < ringCount; i += 1) {
    const radius = EARTH_RADIUS + 0.12 + i * 0.02;
    const tube = 0.005 + i * 0.002;
    const ringGeo = new THREE.TorusGeometry(radius, tube, 16, 160);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(`hsl(${190 + i * 8}, 85%, ${65 + i * 5}%)`),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / (2.4 - i * 0.1);
    ring.rotation.z = i * 0.8;
    searchEffects.add(ring);
  }
  const trailMaterialBase = new THREE.MeshBasicMaterial({
    color: 0x9ee9ff,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  for (let t = 0; t < 4; t += 1) {
    const points = [];
    const startAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i <= 60; i += 1) {
      const angle = startAngle + (i / 60) * Math.PI * 2;
      const radius = EARTH_RADIUS + 0.1 + Math.sin(angle * 3 + t) * 0.015;
      const y = Math.sin(angle * 2 + t * 0.6) * 0.18;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      points.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.25);
    const trailGeo = new THREE.TubeGeometry(curve, 240, 0.004 + Math.random() * 0.002, 6, true);
    const trailMat = trailMaterialBase.clone();
    trailMat.opacity = 0.18 + Math.random() * 0.08;
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.rotation.x = Math.random() * Math.PI;
    searchEffects.add(trail);
  }
}

function setRotationMode(mode) {
  if (!rotationModes[mode]) {
    mode = 'free';
  }
  rotationMode = mode;
  searchEffects.visible = mode === 'search';
}

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const textures = {};

function getStoredQuality() {
  try {
    const stored = localStorage.getItem('earthview_quality');
    if (stored && QUALITY_LEVELS[stored]) {
      return stored;
    }
  } catch (e) {
    console.warn('Impossible de lire le cache qualité', e);
  }
  return 'low';
}

function storeQuality(quality) {
  try {
    localStorage.setItem('earthview_quality', quality);
    console.log(`✓ Qualité ${quality} sauvegardée`);
  } catch (e) {
    console.warn('Impossible de sauvegarder la qualité', e);
  }
}

function getAverageFPS() {
  if (performanceMonitor.fps.length === 0) return 0;
  const sum = performanceMonitor.fps.reduce((a, b) => a + b, 0);
  return sum / performanceMonitor.fps.length;
}

function updateFPSMonitor() {
  const now = performance.now();
  const delta = now - performanceMonitor.lastTime;
  if (delta > 0) {
    const fps = 1000 / delta;
    performanceMonitor.fps.push(fps);
    if (performanceMonitor.fps.length > 60) {
      performanceMonitor.fps.shift();
    }
  }
  performanceMonitor.lastTime = now;
  performanceMonitor.frameCount++;
}

function getNextQualityLevel(current) {
  const levels = ['low', 'high'];
  const currentIndex = levels.indexOf(current);
  if (currentIndex === -1 || currentIndex >= levels.length - 1) {
    return null;
  }
  return levels[currentIndex + 1];
}

async function tryUpgradeQuality() {
  const avgFPS = getAverageFPS();
  const currentLevel = QUALITY_LEVELS[performanceMonitor.currentQuality];
  
  console.log(`FPS moyen: ${avgFPS.toFixed(1)} | Qualité: ${performanceMonitor.currentQuality}`);
  
  if (avgFPS >= currentLevel.targetFPS) {
    const nextQuality = getNextQualityLevel(performanceMonitor.currentQuality);
    if (nextQuality) {
      showStatus(`Performance excellente ! Test de ${QUALITY_LEVELS[nextQuality].name}...`, { persist: true });
      performanceMonitor.currentQuality = nextQuality;
      performanceMonitor.fps = [];
      performanceMonitor.isMonitoring = true;
      performanceMonitor.monitorStart = performance.now();
      
      await loadQualityTextures(nextQuality);
      updateEarthTextures();
      
      return true;
    } else {
      performanceMonitor.qualityLocked = true;
      storeQuality(performanceMonitor.currentQuality);
      showStatus(`Qualité maximale atteinte : ${QUALITY_LEVELS[performanceMonitor.currentQuality].name}`);
      return false;
    }
  } else if (avgFPS < currentLevel.minFPS && performanceMonitor.currentQuality !== 'low') {
    performanceMonitor.qualityLocked = true;
    const levels = ['low', 'high'];
    const previousQuality = levels[levels.indexOf(performanceMonitor.currentQuality) - 1];
    performanceMonitor.currentQuality = previousQuality;
    storeQuality(performanceMonitor.currentQuality);
    showStatus(`Qualité optimale : ${QUALITY_LEVELS[performanceMonitor.currentQuality].name}`);
    return false;
  } else {
    performanceMonitor.qualityLocked = true;
    storeQuality(performanceMonitor.currentQuality);
    showStatus(`Qualité optimale : ${QUALITY_LEVELS[performanceMonitor.currentQuality].name}`);
    return false;
  }
}

async function loadQualityTextures(quality, targetBucket = textures) {
  const qualityConfig = QUALITY_LEVELS[quality];
  const texturePromises = [];
  
  for (const [key, path] of Object.entries(qualityConfig.textures)) {
    const fullPath = assetPath(`../assets/textures/${path}`);
    texturePromises.push(
      loadTexture(key, fullPath).then(texture => {
        targetBucket[key] = texture;
      }).catch(err => {
        console.warn(`Impossible de charger ${key} en qualité ${quality}`, err);
      })
    );
  }
  
  await Promise.all(texturePromises);

  return targetBucket;
}

function updateEarthTextures() {
  if (earthMesh && earthMaterial) {
    earthMaterial.map = textures.earthDay;
    earthMaterial.normalMap = textures.earthNormal;
    earthMaterial.roughnessMap = textures.earthRoughness ?? textures.earthSpecular;
    earthMaterial.needsUpdate = true;
    const shaderUniforms = earthMaterial.userData?.shaderUniforms;
    if (shaderUniforms) {
      if (shaderUniforms.nightMap) {
        shaderUniforms.nightMap.value = textures.earthNight;
      }
      if (shaderUniforms.cloudMap) {
        shaderUniforms.cloudMap.value = textures.clouds;
      }
      if (shaderUniforms.specularMap) {
        shaderUniforms.specularMap.value = textures.earthSpecular;
      }
    }
  }
  
  if (cloudsMesh) {
    cloudsMesh.material.map = textures.clouds;
    cloudsMesh.material.needsUpdate = true;
  }
}

const DATA_TEXTURE_KEYS = new Set(['earthSpecular', 'earthNormal']);

function loadTexture(key, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      texture => {
        const isDataTexture = DATA_TEXTURE_KEYS.has(key);
        texture.colorSpace = isDataTexture ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        resolve(texture);
      },
      undefined,
      error => {
        reject({ error, url });
      }
    );
  });
}

async function loadTextureWithFallback(key) {
  const sources = TEXTURE_SOURCES[key] || [];
  for (const url of sources) {
    try {
      const texture = await loadTexture(key, url);
      textures[key] = texture;
      return;
    } catch (details) {
      console.warn(`Texture manquante (${key}) depuis ${details.url}`, details.error || details);
    }
  }
  throw new Error(`Impossible de charger la texture "${key}"`);
}

async function loadAllTextures() {
  await Promise.all(Object.keys(TEXTURE_SOURCES).map(key => loadTextureWithFallback(key)));
}

function createRoughnessMap(sourceTexture) {
  if (!sourceTexture?.image) {
    return null;
  }
  const { width, height } = sourceTexture.image;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceTexture.image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i];
    const inverted = 255 - value;
    data[i] = inverted;
    data[i + 1] = inverted;
    data[i + 2] = inverted;
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createEarthMaterial(overrides = {}) {
  const baseMap = overrides.map ?? textures.earthDay;
  const baseNormal = overrides.normalMap ?? textures.earthNormal;
  const baseRoughness = overrides.roughnessMap ?? textures.earthRoughness ?? textures.earthSpecular;
  const material = new THREE.MeshStandardMaterial({
    map: baseMap,
    normalMap: baseNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: baseRoughness,
    roughness: 0.78,
    metalness: 0.015
  });

  material.onBeforeCompile = shader => {
    shader.uniforms.sunDirection = { value: sunDirection.clone() };
    shader.uniforms.nightMap = { value: overrides.nightMap ?? textures.earthNight };
    shader.uniforms.cloudMap = { value: textures.clouds };
    shader.uniforms.specularMap = { value: overrides.specularMap ?? textures.earthSpecular };
    shader.uniforms.nightIntensity = { value: 1.4 };
    shader.uniforms.terminatorSoftness = { value: 0.35 };
    shader.uniforms.cityFlicker = { value: 0.03 };
    shader.uniforms.time = { value: 0 };
    material.userData.shaderUniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\n')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          'varying vec3 vWorldNormal;\n' +
          'varying vec3 vWorldPosition;\n' +
          'uniform vec3 sunDirection;\n' +
          'uniform sampler2D nightMap;\n' +
          'uniform sampler2D cloudMap;\n' +
          'uniform sampler2D specularMap;\n' +
          'uniform float nightIntensity;\n' +
          'uniform float terminatorSoftness;\n' +
          'uniform float cityFlicker;\n' +
          'uniform float time;\n'
      )
      .replace(
        '#include <map_fragment>',
        `        vec2 surfaceUv;
        #if defined( USE_MAP )
          surfaceUv = vMapUv;
        #elif defined( USE_UV )
          surfaceUv = vUv;
        #else
          surfaceUv = vec2(0.0);
        #endif
#ifdef USE_MAP
vec4 sampledDiffuseColor = texture2D( map, surfaceUv );
#ifdef DECODE_VIDEO_TEXTURE
sampledDiffuseColor = vec4( mix( sampledDiffuseColor.rgb, vec3( 0.5 ), 0.5 ), sampledDiffuseColor.a );
#endif
diffuseColor *= sampledDiffuseColor;
vec3 daySample = sampledDiffuseColor.rgb;
#else
vec3 daySample = diffuseColor.rgb;
#endif
        vec3 surfaceNormal = normalize(vWorldNormal);
        vec3 lightDir = normalize(sunDirection);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float sunAmount = clamp(dot(surfaceNormal, lightDir), -0.4, 1.0);
        float dayMask = smoothstep(-terminatorSoftness, 0.25, sunAmount);
        float twilight = smoothstep(-0.2, 0.1, sunAmount) * (1.0 - dayMask);
        vec3 duskTint = vec3(1.18, 0.63, 0.32) * twilight;
        float fresnel = pow(1.0 - max(dot(surfaceNormal, viewDir), 0.0), 2.2);
        float polarMask = smoothstep(0.65, 0.95, abs(surfaceNormal.y));
        vec3 iceTint = vec3(0.92, 0.98, 1.08);
        vec2 cloudUv = surfaceUv + vec2(time * 0.0002, time * 0.00035);
        vec3 cloudSample = texture2D(cloudMap, cloudUv).rgb;
        float cloudShadows = smoothstep(0.25, 0.85, dot(cloudSample, vec3(0.333)));
        float shadowAmount = mix(1.0, 0.62, cloudShadows);
        vec3 litSurface = daySample * shadowAmount;
        litSurface = mix(litSurface, iceTint, polarMask);
        vec3 nightBase = mix(vec3(0.02, 0.025, 0.06), daySample * 0.12, 0.4);
        vec3 horizonGlow = vec3(0.08, 0.18, 0.35) * fresnel * 1.35;
        vec3 baseColor = mix(nightBase, litSurface + duskTint + horizonGlow, dayMask);
        diffuseColor.rgb = baseColor;
        diffuseColor.a = 1.0;
      `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float oceanMask = texture2D(specularMap, surfaceUv).g;
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.25, oceanMask);
      `
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float nightSide = smoothstep(0.15, -0.15, sunAmount);
        float flicker = 1.0 + sin(time * 7.0 + vWorldPosition.x * 60.0 + vWorldPosition.y * 45.0) * cityFlicker;
        vec3 nightLights = texture2D(nightMap, surfaceUv).rgb * nightIntensity * nightSide * flicker;
        float horizonBoost = pow(1.0 - max(dot(surfaceNormal, lightDir), 0.0), 4.0);
        nightLights += vec3(0.05, 0.12, 0.2) * horizonBoost;
        totalEmissiveRadiance += nightLights;
      `
      );
  };

  return material;
}

function updateEarthShaderUniforms() {
  const uniforms = earthMaterial?.userData?.shaderUniforms;
  if (!uniforms?.sunDirection) {
    return;
  }
  uniforms.sunDirection.value.copy(sunDirection);
}

function disposeAtmosphereMesh(mesh) {
  if (!mesh) {
    return;
  }
  globeGroup.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

function createAtmosphereLayers() {
  disposeAtmosphereMesh(atmosphereInner);
  disposeAtmosphereMesh(atmosphereOuter);

  const scatteringShader = ({ color, intensity, mie, rayleigh, g, side = THREE.FrontSide }) =>
    new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: sunDirection.clone() },
        color: { value: new THREE.Color(color) },
        intensity: { value: intensity },
        mieCoefficient: { value: mie },
        rayleighCoefficient: { value: rayleigh },
        anisotropy: { value: g }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        uniform vec3 sunDirection;
        uniform vec3 color;
        uniform float intensity;
        uniform float mieCoefficient;
        uniform float rayleighCoefficient;
        uniform float anisotropy;
        const float PI = 3.14159265359;

        float rayleighPhase(float cosTheta) {
          return 3.0 / (16.0 * PI) * (1.0 + pow(cosTheta, 2.0));
        }

        float hgPhase(float cosTheta, float g) {
          return 1.0 / (4.0 * PI) * ((1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
        }

        void main() {
          vec3 n = normalize(vNormal);
          vec3 lightDir = normalize(sunDirection);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float mu = clamp(dot(viewDir, lightDir), -1.0, 1.0);
          float sunAmount = max(dot(n, lightDir), 0.0);
          float horizon = pow(1.0 - max(dot(n, viewDir), 0.0), 2.2);
          vec3 scatter = color * (rayleighCoefficient * rayleighPhase(mu) + mieCoefficient * hgPhase(mu, anisotropy));
          scatter *= (sunAmount * 0.7 + horizon * 1.15);
          float alpha = clamp((sunAmount * 0.45 + horizon), 0.0, 1.0);
          gl_FragColor = vec4(scatter * intensity, alpha * intensity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side
    });

  atmosphereInner = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.025, 196, 196),
    scatteringShader({ color: 0x5ed3ff, intensity: 1.05, mie: 0.005, rayleigh: 1.0, g: 0.65 })
  );
  atmosphereInner.renderOrder = 1.1;
  globeGroup.add(atmosphereInner);

  atmosphereOuter = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.12, 160, 160),
    scatteringShader({ color: 0x1a2d5a, intensity: 0.85, mie: 0.03, rayleigh: 0.35, g: 0.82, side: THREE.BackSide })
  );
  atmosphereOuter.renderOrder = 1.05;
  globeGroup.add(atmosphereOuter);
}

class ChunkedGlobeManager {
  constructor(parentGroup, options = {}) {
    this.config = { ...CHUNK_CONFIG, ...options };
    this.radius = EARTH_RADIUS + this.config.radiusOffset;
    this.parentGroup = parentGroup;
    this.group = new THREE.Group();
    this.group.name = 'highres-chunks';
    this.group.renderOrder = 1.2;
    parentGroup.add(this.group);
    this.latSegments = this.config.latSegments;
    this.lonSegments = this.config.lonSegments;
    this.segmentWidth = Math.max(12, Math.floor(256 / this.lonSegments));
    this.segmentHeight = Math.max(8, Math.floor(128 / this.latSegments));
    this.chunks = new Map();
    this.pendingLoads = new Map();
    this.baseBitmaps = null;
    this.ready = false;
    this.tempVec = new THREE.Vector3();
    this.tempTargets = new Set();
  }

  async prepare(sourceTextures) {
    if (!sourceTextures) {
      return;
    }
    if (typeof createImageBitmap !== 'function') {
      console.warn('createImageBitmap indisponible, chunk streaming désactivé');
      return;
    }
    const entries = [
      ['day', 'earthDay'],
      ['normal', 'earthNormal'],
      ['specular', 'earthSpecular'],
      ['night', 'earthNight']
    ];
    this.baseBitmaps = {};
    await Promise.all(
      entries.map(async ([slot, key]) => {
        const texture = sourceTextures[key];
        if (!texture?.image) {
          return;
        }
        this.baseBitmaps[slot] = await createImageBitmap(texture.image);
      })
    );
    Object.values(sourceTextures).forEach(tex => tex?.dispose?.());
    this.ready = Boolean(this.baseBitmaps.day);
    if (this.ready) {
      console.info('Streaming haute résolution prêt');
    }
  }

  update(camera) {
    if (!this.ready) {
      return;
    }
    const now = performance.now();
    const viewDir = this.tempVec;
    camera.getWorldDirection(viewDir);
    viewDir.normalize();
    const lat = THREE.MathUtils.radToDeg(Math.asin(viewDir.y));
    let lon = THREE.MathUtils.radToDeg(Math.atan2(viewDir.z, -viewDir.x));
    if (!Number.isFinite(lon)) {
      lon = 0;
    }
    const latRatio = (90 - lat) / 180;
    const lonRatio = (lon + 180) / 360;
    const baseLatIndex = THREE.MathUtils.clamp(Math.floor(latRatio * this.latSegments), 0, this.latSegments - 1);
    const baseLonIndex = THREE.MathUtils.euclideanModulo(Math.floor(lonRatio * this.lonSegments), this.lonSegments);
    const desired = [];
    for (let dLat = -this.config.verticalNeighborhood; dLat <= this.config.verticalNeighborhood; dLat += 1) {
      const latIndex = THREE.MathUtils.clamp(baseLatIndex + dLat, 0, this.latSegments - 1);
      for (let dLon = -this.config.lateralNeighborhood; dLon <= this.config.lateralNeighborhood; dLon += 1) {
        const lonIndex = THREE.MathUtils.euclideanModulo(baseLonIndex + dLon, this.lonSegments);
        desired.push({ latIndex, lonIndex });
      }
    }
    this.ensureChunks(desired, now);
    this.evictStale(desired, now);
  }

  updateSunDirection(direction) {
    if (!direction) {
      return;
    }
    for (const chunk of this.chunks.values()) {
      const uniforms = chunk.mesh.material?.userData?.shaderUniforms;
      if (uniforms?.sunDirection) {
        uniforms.sunDirection.value.copy(direction);
      }
    }
  }

  ensureChunks(targetList, timestamp) {
    this.tempTargets.clear();
    for (const target of targetList) {
      const key = this.chunkKey(target.latIndex, target.lonIndex);
      this.tempTargets.add(key);
      const loaded = this.chunks.get(key);
      if (loaded) {
        loaded.lastUsed = timestamp;
        continue;
      }
      if (this.pendingLoads.has(key)) {
        continue;
      }
      if (this.chunks.size + this.pendingLoads.size >= this.config.maxActive) {
        continue;
      }
      this.loadChunk(target.latIndex, target.lonIndex, key, timestamp);
    }
  }

  evictStale(targetList, timestamp) {
    const activeKeys = this.tempTargets;
    for (const [key, chunk] of this.chunks) {
      if (activeKeys.has(key)) {
        continue;
      }
      if (timestamp - chunk.lastUsed >= this.config.keepAlive) {
        this.disposeChunk(key, chunk);
      }
    }
  }

  loadChunk(latIndex, lonIndex, key, timestamp) {
    const loadPromise = this.buildChunk(latIndex, lonIndex)
      .then(chunk => {
        this.pendingLoads.delete(key);
        if (!chunk) {
          return;
        }
        chunk.lastUsed = timestamp;
        this.chunks.set(key, chunk);
        this.group.add(chunk.mesh);
      })
      .catch(error => {
        this.pendingLoads.delete(key);
        console.warn('Chunk haute résolution indisponible', error);
      });
    this.pendingLoads.set(key, loadPromise);
  }

  async buildChunk(latIndex, lonIndex) {
    if (!this.baseBitmaps?.day) {
      return null;
    }
    const tileTextures = await this.generateChunkTextures(latIndex, lonIndex);
    if (!tileTextures.day) {
      return null;
    }
    const phiLength = (Math.PI * 2) / this.lonSegments;
    const thetaLength = Math.PI / this.latSegments;
    const geometry = new THREE.SphereGeometry(
      this.radius,
      this.segmentWidth,
      this.segmentHeight,
      lonIndex * phiLength,
      phiLength,
      latIndex * thetaLength,
      thetaLength
    );
    const material = createEarthMaterial({
      map: tileTextures.day,
      normalMap: tileTextures.normal,
      roughnessMap: tileTextures.specular,
      nightMap: tileTextures.night
    });
    material.transparent = true;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = true;
    mesh.frustumCulled = true;
    mesh.renderOrder = 1.2;
    return { mesh, textures: tileTextures, latIndex, lonIndex };
  }

  async generateChunkTextures(latIndex, lonIndex) {
    const tileWidth = Math.floor(this.baseBitmaps.day.width / this.lonSegments);
    const tileHeight = Math.floor(this.baseBitmaps.day.height / this.latSegments);
    const sx = lonIndex * tileWidth;
    const sy = latIndex * tileHeight;
    const result = {};
    result.day = await this.createTextureFromBitmap(this.baseBitmaps.day, sx, sy, tileWidth, tileHeight, false);
    result.normal = await this.createTextureFromBitmap(this.baseBitmaps.normal, sx, sy, tileWidth, tileHeight, true);
    result.specular = await this.createTextureFromBitmap(this.baseBitmaps.specular, sx, sy, tileWidth, tileHeight, true);
    result.night = await this.createTextureFromBitmap(this.baseBitmaps.night, sx, sy, tileWidth, tileHeight, false);
    return result;
  }

  async createTextureFromBitmap(sourceBitmap, sx, sy, sw, sh, linear = false) {
    if (!sourceBitmap) {
      return null;
    }
    const bitmap = await createImageBitmap(sourceBitmap, sx, sy, sw, sh);
    const texture = new THREE.Texture(bitmap);
    texture.needsUpdate = true;
    texture.colorSpace = linear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = 4;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  disposeChunk(key, chunk) {
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    if (chunk.mesh.material?.dispose) {
      const uniforms = chunk.mesh.material.userData?.shaderUniforms;
      if (uniforms?.nightMap && uniforms.nightMap.value?.image?.close) {
        uniforms.nightMap.value.image.close();
      }
      chunk.mesh.material.dispose();
    }
    this.disposeTexture(chunk.textures?.day);
    this.disposeTexture(chunk.textures?.normal);
    this.disposeTexture(chunk.textures?.specular);
    this.disposeTexture(chunk.textures?.night);
    this.chunks.delete(key);
  }

  disposeTexture(texture) {
    if (!texture) {
      return;
    }
    texture.image?.close?.();
    texture.dispose();
  }

  chunkKey(latIndex, lonIndex) {
    return `${latIndex}:${lonIndex}`;
  }
}

if (!chunkManager) {
  chunkManager = new ChunkedGlobeManager(globeGroup);
}

function updateAtmosphereUniforms() {
  if (atmosphereInner?.material?.uniforms?.sunDirection) {
    atmosphereInner.material.uniforms.sunDirection.value.copy(sunDirection);
  }
  if (atmosphereOuter?.material?.uniforms?.sunDirection) {
    atmosphereOuter.material.uniforms.sunDirection.value.copy(sunDirection);
  }
}

function updateSunPosition(force = false) {
  const now = Date.now();
  if (force || now - lastSunCalculation >= SUN_UPDATE_INTERVAL_MS) {
    cachedSunDirection.copy(computeSunDirection(new Date(now)));
    lastSunCalculation = now;
  }
  sunPositionVector.copy(cachedSunDirection).multiplyScalar(SUN_DISTANCE);
  sun.position.copy(sunPositionVector);
  sun.lookAt(sunTarget.position);
  if (sunBillboard) {
    sunBillboard.position.copy(sunPositionVector);
    const spriteScale = SUN_DISTANCE * 0.35;
    sunBillboard.scale.set(spriteScale, spriteScale, spriteScale);
  }
  updateSunUniform();
}

function buildEarth() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 256, 256);
  earthMaterial = createEarthMaterial();
  const earth = new THREE.Mesh(geometry, earthMaterial);
  earth.castShadow = true;
  earth.receiveShadow = true;
  earth.name = 'earth';
  globeGroup.add(earth);
  earthMesh = earth;

  // Les lumières de nuit sont déjà intégrées dans le earthMaterial via le shader personnalisé
  // nightLightsMaterial = createNightLightsMaterial();
  // nightLightsMesh = new THREE.Mesh(geometry.clone(), nightLightsMaterial);
  // nightLightsMesh.renderOrder = 0.8;
  // globeGroup.add(nightLightsMesh);

  const cloudsGeo = new THREE.SphereGeometry(EARTH_RADIUS + CLOUD_OFFSET, 192, 192);
  const cloudsMat = new THREE.MeshStandardMaterial({
    map: textures.clouds,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    roughness: 1,
    metalness: 0
  });
  cloudsMat.onBeforeCompile = shader => {
    shader.uniforms.sunDirection = { value: sunDirection.clone() };
    shader.uniforms.time = { value: 0 };
    cloudsMat.userData = cloudsMat.userData || {};
    cloudsMat.userData.sunUniform = shader.uniforms.sunDirection;
    cloudsMat.userData.timeUniform = shader.uniforms.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;\n')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
      `
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          'varying vec3 vWorldNormal;\n' +
          'uniform vec3 sunDirection;\n' +
          'uniform float time;\n' +
          'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }\n' +
          'float noise(vec2 p) {\n' +
          '  vec2 i = floor(p);\n' +
          '  vec2 f = fract(p);\n' +
          '  float a = hash(i);\n' +
          '  float b = hash(i + vec2(1.0, 0.0));\n' +
          '  float c = hash(i + vec2(0.0, 1.0));\n' +
          '  float d = hash(i + vec2(1.0, 1.0));\n' +
          '  vec2 u = f * f * (3.0 - 2.0 * f);\n' +
          '  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;\n' +
          '}\n' +
          'float fbm(vec2 p) {\n' +
          '  float v = 0.0;\n' +
          '  float amp = 0.5;\n' +
          '  for (int i = 0; i < 4; i++) {\n' +
          '    v += noise(p) * amp;\n' +
          '    p *= 2.7;\n' +
          '    amp *= 0.5;\n' +
          '  }\n' +
          '  return v;\n' +
          '}\n'
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 cloudUv;
        #if defined( USE_MAP )
          cloudUv = vMapUv;
        #elif defined( USE_UV )
          cloudUv = vUv;
        #else
          cloudUv = vec2(0.0);
        #endif
        vec2 animatedUv = cloudUv + vec2(time * 0.002, time * 0.0008);
        float detail = fbm(animatedUv * 3.0);
        float wisps = fbm(animatedUv * 9.0);
        float density = clamp(detail * 0.7 + wisps * 0.3, 0.0, 1.0);
        float sunFacing = clamp(dot(normalize(vWorldNormal), normalize(sunDirection)), 0.0, 1.0);
        float forwardScatter = pow(sunFacing, 2.2);
        diffuseColor.a *= mix(0.35, 0.95, density);
        diffuseColor.a *= mix(0.55, 1.05, forwardScatter);
        diffuseColor.rgb *= 0.85 + density * 0.2;
        diffuseColor.rgb += vec3(0.25, 0.32, 0.42) * forwardScatter * 0.35;
      `
      );
  };
  const clouds = new THREE.Mesh(cloudsGeo, cloudsMat);
  clouds.name = 'clouds';
  globeGroup.add(clouds);
  cloudsMesh = clouds;

  createAtmosphereLayers();

  const starGeo = new THREE.SphereGeometry(140, 64, 64);
  const starMat = new THREE.MeshBasicMaterial({
    map: textures.starfield,
    side: THREE.BackSide,
    color: 0xffffff,
    transparent: true,
    opacity: 0.85
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  scene.add(starMesh);
  starParticles = createStarParticles(1600, 125);
  scene.add(starParticles);
  updateSunUniform();
}

function animate() {
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    const elapsed = clock.elapsedTime;
    const now = performance.now();
    const speeds = rotationModes[rotationMode] || rotationModes.free;
    
    if (!performanceMonitor.qualityLocked) {
      updateFPSMonitor();
      
      if (performanceMonitor.isMonitoring) {
        const monitorElapsed = now - performanceMonitor.monitorStart;
        if (monitorElapsed >= performanceMonitor.monitorDuration) {
          performanceMonitor.isMonitoring = false;
          tryUpgradeQuality();
        }
      } else if (performanceMonitor.frameCount > 60) {
        performanceMonitor.isMonitoring = true;
        performanceMonitor.monitorStart = now;
      }
    }
    if (earthMesh) {
      earthMesh.rotation.y += speeds.earth * delta;
    }
    if (cloudsMesh) {
      cloudsMesh.rotation.y += speeds.clouds * delta;
    }
    if (searchEffects.visible) {
      searchEffects.rotation.y += delta * 0.45;
      searchEffects.rotation.x += delta * 0.12;
    }
    if (starParticles) {
      starParticles.rotation.y += delta * 0.02;
    }
    updateSunPosition();
    updatePulses(now);
    chunkManager?.update(camera);
    updateCameraTransition();
    const earthUniforms = earthMaterial?.userData?.shaderUniforms;
    if (earthUniforms?.time) {
      earthUniforms.time.value = elapsed;
    }
    const cloudUniforms = cloudsMesh?.material?.userData;
    if (cloudUniforms?.timeUniform) {
      cloudUniforms.timeUniform.value = elapsed;
    }
    if (cinematicPass) {
      cinematicPass.uniforms.time.value = elapsed;
    }
    camera.lookAt(cameraTarget);
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  });
}

function applyCameraDescriptor(descriptor) {
  const parsed = parseCameraDescriptor(descriptor);
  if (!parsed) {
    return;
  }
  camera.position.set(parsed.position.x, parsed.position.y, parsed.position.z);
  camera.fov = parsed.fov;
  camera.updateProjectionMatrix();
  camera.up.set(0, 1, 0);
  cameraTarget.set(0, 0, 0);
  camera.lookAt(cameraTarget);
  camera.rotateZ(THREE.MathUtils.degToRad(parsed.rollDeg));
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateComposerSize();
}

function latLonToVector3(lat, lon, radius = EARTH_RADIUS + 0.02) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

const haloReferenceNormal = new THREE.Vector3(0, 0, 1);
const focusNormal = new THREE.Vector3();
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

function startCameraTransition(targetPosition, { duration = TRANSITION_DURATION, onComplete } = {}) {
  cameraTransition = {
    start: performance.now(),
    duration,
    from: camera.position.clone(),
    to: targetPosition.clone(),
    onComplete
  };
}

function updateCameraTransition() {
  if (!cameraTransition) {
    return;
  }
  const elapsed = performance.now() - cameraTransition.start;
  const progress = Math.min(elapsed / cameraTransition.duration, 1);
  const eased = easeOutCubic(progress);
  camera.position.lerpVectors(cameraTransition.from, cameraTransition.to, eased);
  camera.lookAt(cameraTarget);
  if (progress >= 1) {
    const { onComplete } = cameraTransition;
    cameraTransition = null;
    if (onComplete) {
      onComplete();
    }
  }
}

async function requestDeviceCoordinates() {
  if (!('geolocation' in navigator)) {
    return null;
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: 'device'
        }),
      error => reject(error),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
  });
}

async function fetchIpLocation() {
  const response = await fetch('https://ipapi.co/json/');
  if (!response.ok) {
    throw new Error('HTTP ' + response.status);
  }
  const data = await response.json();
  const lat = parseFloat(data.latitude);
  const lon = parseFloat(data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Données de localisation manquantes');
  }
  return { lat, lon, source: 'ip' };
}

async function resolveUserLocation() {
  try {
    const deviceCoords = await requestDeviceCoordinates();
    if (deviceCoords) {
      return deviceCoords;
    }
  } catch (error) {
    console.warn('Géolocalisation navigateur refusée ou échouée', error);
  }
  try {
    return await fetchIpLocation();
  } catch (error) {
    console.warn('Géolocalisation IP indisponible', error);
    return null;
  }
}

async function placeUserMarker({ autoFrame = false } = {}) {
  if (autoFrame) {
    setRotationMode('search');
    showStatus('Recherche de ta localisation...', { persist: true });
  }
  const location = await resolveUserLocation();
  if (!location) {
    setRotationMode('free');
    showStatus('Impossible de récupérer ta position', { persist: false });
    return;
  }
  if (autoFrame) {
    const label = location.source === 'device' ? 'Position détectée, alignement...' : 'Position approximative, alignement...';
    showStatus(label, { persist: true });
  } else {
    const label = location.source === 'device' ? 'Position détectée' : 'Position approximative';
    showStatus(label, { persist: false });
  }
  const locationVector = latLonToVector3(location.lat, location.lon);
  resetMarkerEffects();
  const outward = locationVector.clone().normalize();
  markerAnchor = new THREE.Object3D();
  markerAnchor.position.copy(locationVector);
  markerAnchor.quaternion.setFromUnitVectors(haloReferenceNormal, outward);
  globeGroup.add(markerAnchor);

  const coreGeometry = new THREE.SphereGeometry(0.007, 16, 16);
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xb4f8d2 });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.set(0, 0, 0.002);
  markerAnchor.add(core);

  const outlineGeometry = new THREE.RingGeometry(0.009, 0.015, 48);
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xb4f8d2,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
  outline.position.set(0, 0, 0.0025);
  markerAnchor.add(outline);

  markerPulseConfig.anchor = markerAnchor;
  markerPulseConfig.lastEmission = performance.now();
  spawnPulse();

  if (autoFrame) {
    setRotationMode('focusing');
    focusNormal.copy(locationVector).normalize();
    cameraTarget.copy(locationVector);
    const targetDistance = 2.6;
    const targetPosition = focusNormal.clone().multiplyScalar(targetDistance);
    const lateral = focusNormal.clone().cross(worldUp);
    if (lateral.lengthSq() < 0.001) {
      lateral.set(1, 0, 0);
    }
    lateral.normalize().multiplyScalar(0.22);
    targetPosition.add(lateral);
    targetPosition.add(worldUp.clone().multiplyScalar(0.45));
    targetPosition.y = THREE.MathUtils.clamp(targetPosition.y, -0.4, 1.5);
    startCameraTransition(targetPosition, {
      onComplete: () => {
        setRotationMode('locked');
        hideStatus(1200);
      }
    });
  } else {
    cameraTarget.set(0, 0, 0);
    setRotationMode('free');
    hideStatus(1500);
  }
}

async function primeChunkStreaming() {
  if (!chunkManager || chunkStreamingPromise) {
    return chunkStreamingPromise;
  }
  chunkStreamingPromise = (async () => {
    try {
      const highBucket = await loadQualityTextures('high', {});
      await chunkManager.prepare(highBucket);
      chunkManager.updateSunDirection(sunDirection);
      showStatus('Textures haute résolution actives (zones ciblées)', { persist: false });
    } catch (error) {
      console.warn('Chunk streaming indisponible', error);
    }
  })();
  return chunkStreamingPromise;
}

async function init() {
  const storedQuality = getStoredQuality();
  performanceMonitor.currentQuality = storedQuality;
  
  showStatus(`Chargement en qualité ${QUALITY_LEVELS[storedQuality].name}...`, { persist: true });
  
  // Toujours charger depuis les niveaux de qualité, jamais depuis TEXTURE_SOURCES
  await loadQualityTextures(storedQuality);
  
  textures.earthRoughness = createRoughnessMap(textures.earthSpecular);
  textures.starfield = createStarfieldTexture(THREE, { size: 4096, starCount: 4200, maxRadius: 0.15 });
  buildEarth();
  primeChunkStreaming();
  setupPostProcessing();
  const descriptor = extractDescriptorFromPath(window.location.pathname, document.documentElement.dataset.siteBase);
  const parsed = parseCameraDescriptor(descriptor);
  if (!parsed && descriptor) {
    console.warn('Camera descriptor invalide :', descriptor);
  }
  const hasCustomCamera = Boolean(parsed);
  if (hasCustomCamera) {
    applyCameraDescriptor(descriptor);
    setRotationMode('free');
  } else {
    setRotationMode('search');
  }
  loadingLabel.remove();
  
  // Si qualité basse, surveiller les perfs pour monter en qualité
  if (storedQuality === 'low') {
    performanceMonitor.qualityLocked = false;
    performanceMonitor.isMonitoring = true;
    performanceMonitor.monitorStart = performance.now();
  } else {
    performanceMonitor.qualityLocked = true;
  }
  hideStatus();
  
  animate();
  placeUserMarker({ autoFrame: !hasCustomCamera });
}

window.addEventListener('resize', handleResize);

init().catch(error => {
  loadingLabel.textContent = 'Erreur';
  console.error(error);
});
