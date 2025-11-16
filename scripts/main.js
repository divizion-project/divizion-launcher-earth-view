import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { extractDescriptorFromPath, parseCameraDescriptor } from './camera.js';
import { createStarfieldTexture } from './starfield.js';

const assetPath = relative => new URL(relative, import.meta.url).href;

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

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000, 1);
const clock = new THREE.Clock();
let cameraTransition = null;
let statusTimeout = null;
const cameraTarget = new THREE.Vector3(0, 0, 0);
const worldUp = new THREE.Vector3(0, 1, 0);
const sunDirection = new THREE.Vector3();
const rotationModes = {
  search: { earth: EARTH_ROTATION_SPEED * 3.5, clouds: CLOUD_ROTATION_SPEED * 3 },
  focusing: { earth: EARTH_ROTATION_SPEED * 1.2, clouds: CLOUD_ROTATION_SPEED * 1.6 },
  locked: { earth: 0, clouds: CLOUD_ROTATION_SPEED * 0.9 },
  free: { earth: EARTH_ROTATION_SPEED, clouds: CLOUD_ROTATION_SPEED * 1.05 }
};
let rotationMode = 'search';

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
    depthTest: false
  });
}

function updateSunUniform() {
  sunDirection.copy(sun.position).normalize();
  if (nightLightsMaterial) {
    nightLightsMaterial.uniforms.sunDirection.value.copy(sunDirection);
  }
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

function buildEarth() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 256, 256);
  const material = new THREE.MeshStandardMaterial({
    map: textures.earthDay,
    normalMap: textures.earthNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: textures.earthRoughness ?? textures.earthSpecular,
    roughness: 1,
    metalness: 0.04,
    emissiveMap: textures.earthNight,
    emissive: new THREE.Color(0x05122a),
    emissiveIntensity: 0.65
  });
  const earth = new THREE.Mesh(geometry, material);
  earth.castShadow = true;
  earth.receiveShadow = true;
  earth.name = 'earth';
  globeGroup.add(earth);
  earthMesh = earth;

  nightLightsMaterial = createNightLightsMaterial();
  nightLightsMesh = new THREE.Mesh(geometry.clone(), nightLightsMaterial);
  nightLightsMesh.renderOrder = 0.8;
  globeGroup.add(nightLightsMesh);

  const cloudsGeo = new THREE.SphereGeometry(EARTH_RADIUS + CLOUD_OFFSET, 192, 192);
  const cloudsMat = new THREE.MeshStandardMaterial({
    map: textures.clouds,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    roughness: 1,
    metalness: 0
  });
  const clouds = new THREE.Mesh(cloudsGeo, cloudsMat);
  clouds.name = 'clouds';
  globeGroup.add(clouds);
  cloudsMesh = clouds;

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
    const now = performance.now();
    const speeds = rotationModes[rotationMode] || rotationModes.free;
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
    updatePulses(now);
    updateCameraTransition();
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
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
  renderer.setSize(window.innerWidth, window.innerHeight);
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

async function init() {
  await loadAllTextures();
  textures.earthRoughness = createRoughnessMap(textures.earthSpecular);
  textures.starfield = createStarfieldTexture(THREE, { size: 4096, starCount: 4200, maxRadius: 0.15 });
  buildEarth();
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
  animate();
  placeUserMarker({ autoFrame: !hasCustomCamera });
}

window.addEventListener('resize', handleResize);

init().catch(error => {
  loadingLabel.textContent = 'Erreur';
  console.error(error);
});
