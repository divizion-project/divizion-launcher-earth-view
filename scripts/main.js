import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { extractDescriptorFromPath, parseCameraDescriptor } from './camera.js';

const TEXTURES = {
  earthDay: 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
  earthSpecular: 'https://threejs.org/examples/textures/planets/earth_specular_2048.jpg',
  earthNormal: 'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg',
  earthNight: 'https://threejs.org/examples/textures/planets/earth_lights_2048.png',
  clouds: 'https://threejs.org/examples/textures/planets/earth_clouds_1024.png',
  starfield: 'https://threejs.org/examples/textures/planets/starfield.jpg'
};

const EARTH_RADIUS = 1;
const CLOUD_OFFSET = 0.01;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const root = document.querySelector('#scene-root');
root.appendChild(renderer.domElement);

const loadingLabel = document.createElement('div');
loadingLabel.className = 'loading';
loadingLabel.textContent = 'LOADING';
root.appendChild(loadingLabel);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0.4, 3.5);
camera.lookAt(0, 0, 0);

const sun = new THREE.DirectionalLight(0xffffff, 2.25);
sun.position.set(-5, 3, 4);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x0f1429, 0.8));

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const loader = new THREE.TextureLoader();
const textures = {};

async function loadAllTextures() {
  const entries = Object.entries(TEXTURES);
  await Promise.all(
    entries.map(([key, url]) => {
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            textures[key] = texture;
            resolve();
          },
          undefined,
          reject
        );
      });
    })
  );
}

function buildEarth() {
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
  const material = new THREE.MeshPhongMaterial({
    map: textures.earthDay,
    specularMap: textures.earthSpecular,
    shininess: 20,
    emissiveMap: textures.earthNight,
    emissive: new THREE.Color(0x555577),
    emissiveIntensity: 0.8,
    normalMap: textures.earthNormal,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });
  const earth = new THREE.Mesh(geometry, material);
  earth.name = 'earth';
  globeGroup.add(earth);

  const cloudsGeo = new THREE.SphereGeometry(EARTH_RADIUS + CLOUD_OFFSET, 96, 96);
  const cloudsMat = new THREE.MeshLambertMaterial({
    map: textures.clouds,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });
  const clouds = new THREE.Mesh(cloudsGeo, cloudsMat);
  clouds.name = 'clouds';
  globeGroup.add(clouds);

  const starGeo = new THREE.SphereGeometry(120, 64, 64);
  const starMat = new THREE.MeshBasicMaterial({
    map: textures.starfield,
    side: THREE.BackSide
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  scene.add(starMesh);
}

function animate() {
  renderer.setAnimationLoop(() => {
    const earth = globeGroup.getObjectByName('earth');
    const clouds = globeGroup.getObjectByName('clouds');
    if (earth) {
      earth.rotation.y += 0.0004;
    }
    if (clouds) {
      clouds.rotation.y += 0.0006;
    }
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
  camera.lookAt(0, 0, 0);
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

async function placeUserMarker() {
  try {
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
    const markerGeometry = new THREE.SphereGeometry(0.02, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x6aff7f });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(latLonToVector3(lat, lon));
    globeGroup.add(marker);

    const haloGeometry = new THREE.RingGeometry(0.03, 0.05, 32);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x6aff7f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    const outward = marker.position.clone().normalize();
    halo.position.copy(outward.clone().multiplyScalar(EARTH_RADIUS + 0.021));
    halo.lookAt(outward.clone().multiplyScalar(2));
    globeGroup.add(halo);
  } catch (error) {
    console.warn('Impossible de récupérer la localisation :', error);
  }
}

async function init() {
  await loadAllTextures();
  buildEarth();
  const descriptor = extractDescriptorFromPath(window.location.pathname, document.documentElement.dataset.siteBase);
  const parsed = parseCameraDescriptor(descriptor);
  if (!parsed && descriptor) {
    console.warn('Camera descriptor invalide :', descriptor);
  }
  if (parsed) {
    applyCameraDescriptor(descriptor);
  }
  loadingLabel.remove();
  animate();
  placeUserMarker();
}

window.addEventListener('resize', handleResize);

init().catch(error => {
  loadingLabel.textContent = 'Erreur';
  console.error(error);
});
