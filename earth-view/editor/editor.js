import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { buildCameraDescriptor, parseCameraDescriptor } from '../../scripts/camera.js';
import { createStarfieldTexture } from '../../scripts/starfield.js';

const texturePath = file => new URL(`../../assets/textures/${file}`, import.meta.url).href;

const TEXTURE_SOURCES = {
  earthDay: [texturePath('earth_day_5400.jpg'), 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'],
  earthSpecular: [texturePath('earth_specular_2048.jpg'), 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'],
  earthNormal: [texturePath('earth_normal_2048.jpg'), 'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg'],
  earthNight: [texturePath('earth_night_5400.jpg'), 'https://threejs.org/examples/textures/planets/earth_lights_2048.png'],
  clouds: [texturePath('earth_clouds_2048.png'), 'https://threejs.org/examples/textures/planets/earth_clouds_1024.png']
};

const viewport = document.getElementById('viewport');
const descriptorOutput = document.getElementById('descriptorOutput');
const copyBtn = document.getElementById('copyDescriptor');
const rollInput = document.getElementById('rollInput');
const rollValue = document.getElementById('rollValue');
const fovInput = document.getElementById('fovInput');
const fovValue = document.getElementById('fovValue');
const coordX = document.getElementById('coordX');
const coordY = document.getElementById('coordY');
const coordZ = document.getElementById('coordZ');
const descriptorInput = document.getElementById('descriptorInput');
const loadDescriptorBtn = document.getElementById('loadDescriptor');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(0, 1.5, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.6;
controls.maxDistance = 10;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = Math.PI - 0.2;
controls.target.set(0, 0, 0);

const editorSunTarget = new THREE.Object3D();
editorSunTarget.position.set(0, 0, 0);
scene.add(editorSunTarget);

const light = new THREE.DirectionalLight(0xfff2d8, 3.2);
light.position.set(-9, 5, 6.5);
light.target = editorSunTarget;
scene.add(light);
scene.add(new THREE.HemisphereLight(0x2e4a80, 0x050505, 0.35));

const rim = new THREE.PointLight(0x1b4fff, 0.4);
rim.position.set(2.5, 1.5, -3.5);
scene.add(rim);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const textures = {};

const state = {
  rollDeg: 0,
  fov: camera.fov,
  descriptor: ''
};

function resizeRenderer() {
  const width = viewport.clientWidth || window.innerWidth;
  const height = viewport.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeRenderer);
resizeRenderer();

const DATA_TEXTURE_KEYS = new Set(['earthSpecular', 'earthNormal']);

function loadTexture(key, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      texture => {
        const isDataTexture = DATA_TEXTURE_KEYS.has(key);
        texture.colorSpace = isDataTexture ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        texture.anisotropy = 6;
        resolve(texture);
      },
      undefined,
      error => reject({ error, url })
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
      console.warn(`Editor texture manquante (${key}) depuis ${details.url}`, details.error || details);
    }
  }
  throw new Error(`Impossible de charger la texture "${key}"`);
}

async function loadTextures() {
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
  const geometry = new THREE.SphereGeometry(1, 256, 256);
  const material = new THREE.MeshStandardMaterial({
    map: textures.earthDay,
    normalMap: textures.earthNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: textures.earthRoughness ?? textures.earthSpecular,
    roughness: 0.95,
    metalness: 0.02,
    emissiveMap: textures.earthNight,
    emissive: new THREE.Color(0x05122a),
    emissiveIntensity: 0.65
  });
  const earth = new THREE.Mesh(geometry, material);
  earth.name = 'earth';
  globeGroup.add(earth);

  const cloudsGeo = new THREE.SphereGeometry(1.01, 192, 192);
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

  const atmosphereGeo = new THREE.SphereGeometry(1.08, 196, 196);
  const atmosphereMat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x82c9ff) },
      horizonColor: { value: new THREE.Color(0x2ba1ff) },
      intensity: { value: 1.1 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      uniform vec3 glowColor;
      uniform vec3 horizonColor;
      uniform float intensity;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);
        vec3 color = mix(horizonColor, glowColor, smoothstep(0.0, 1.0, fresnel * 1.2));
        gl_FragColor = vec4(color, fresnel * intensity);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide
  });
  const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
  atmosphere.renderOrder = 1;
  globeGroup.add(atmosphere);

  const starGeo = new THREE.SphereGeometry(140, 64, 64);
  const starMat = new THREE.MeshBasicMaterial({
    map: textures.starfield,
    side: THREE.BackSide
  });
  const stars = new THREE.Mesh(starGeo, starMat);
  scene.add(stars);
}

const baseQuaternion = new THREE.Quaternion();
const rollAxis = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, -1);

function applyRoll() {
  baseQuaternion.copy(camera.quaternion);
  if (!state.rollDeg) {
    return;
  }
  rollAxis.copy(forward).applyQuaternion(baseQuaternion).normalize();
  camera.quaternion.copy(baseQuaternion);
  camera.rotateOnWorldAxis(rollAxis, THREE.MathUtils.degToRad(state.rollDeg));
}

function render() {
  requestAnimationFrame(render);
  controls.update();
  applyRoll();
  renderer.render(scene, camera);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function buildPreview(descriptor) {
  const base = document.documentElement.dataset.siteBase?.trim();
  const root = base ? `/${base}` : '';
  if (!descriptor) {
    return root || '/';
  }
  return `${root}/${descriptor}`;
}

function updateDescriptor() {
  coordX.textContent = formatNumber(camera.position.x);
  coordY.textContent = formatNumber(camera.position.y);
  coordZ.textContent = formatNumber(camera.position.z);

  const descriptor = buildCameraDescriptor({
    position: camera.position,
    rollDeg: state.rollDeg,
    fov: state.fov
  });
  state.descriptor = descriptor;
  descriptorOutput.value = buildPreview(descriptor);
  descriptorOutput.dataset.descriptor = descriptor;
}

controls.addEventListener('change', () => {
  updateDescriptor();
});

rollInput.addEventListener('input', event => {
  state.rollDeg = Number(event.target.value) || 0;
  rollValue.textContent = `${Math.round(state.rollDeg)}°`;
  updateDescriptor();
});

fovInput.addEventListener('input', event => {
  state.fov = Number(event.target.value) || 45;
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
  fovValue.textContent = `${Math.round(state.fov)}°`;
  updateDescriptor();
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(descriptorOutput.value);
    copyBtn.textContent = 'Copié !';
    setTimeout(() => (copyBtn.textContent = 'Copier'), 1500);
  } catch (error) {
    copyBtn.textContent = 'Erreur';
    setTimeout(() => (copyBtn.textContent = 'Copier'), 1500);
  }
});

loadDescriptorBtn.addEventListener('click', () => {
  const parsed = parseCameraDescriptor(descriptorInput.value.trim());
  if (!parsed) {
    descriptorInput.classList.add('error');
    descriptorInput.placeholder = 'Code invalide';
    return;
  }
  descriptorInput.classList.remove('error');
  descriptorInput.placeholder = 'x0y0z4def0-zoom45';
  camera.position.set(parsed.position.x, parsed.position.y, parsed.position.z);
  state.rollDeg = parsed.rollDeg;
  rollInput.value = String(parsed.rollDeg);
  rollValue.textContent = `${Math.round(parsed.rollDeg)}°`;
  state.fov = parsed.fov;
  fovInput.value = String(parsed.fov);
  fovValue.textContent = `${Math.round(parsed.fov)}°`;
  camera.fov = parsed.fov;
  camera.updateProjectionMatrix();
  controls.update();
  controls.saveState();
  updateDescriptor();
});

descriptorInput.addEventListener('input', () => {
  descriptorInput.classList.remove('error');
});

descriptorInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadDescriptorBtn.click();
  }
});

function loadDescriptorFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash?.replace('#', '');
  const value = params.get('camera') || params.get('code') || hash;
  if (!value) {
    return;
  }
  const parsed = parseCameraDescriptor(value);
  if (parsed) {
    camera.position.set(parsed.position.x, parsed.position.y, parsed.position.z);
    state.rollDeg = parsed.rollDeg;
    rollInput.value = String(parsed.rollDeg);
    rollValue.textContent = `${Math.round(parsed.rollDeg)}°`;
    state.fov = parsed.fov;
    camera.fov = parsed.fov;
    camera.updateProjectionMatrix();
    fovInput.value = String(parsed.fov);
    fovValue.textContent = `${Math.round(parsed.fov)}°`;
  }
}

async function init() {
  await loadTextures();
  textures.earthRoughness = createRoughnessMap(textures.earthSpecular);
  textures.starfield = createStarfieldTexture(THREE, { size: 4096, starCount: 4200, maxRadius: 0.15 });
  buildEarth();
  loadDescriptorFromQuery();
  updateDescriptor();
  render();
}

init().catch(error => {
  console.error('Editor init error', error);
});
