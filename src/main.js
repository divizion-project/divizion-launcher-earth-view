import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import gsap from 'gsap';
import SunCalc from 'suncalc';
import { createEarthMaterial } from './EarthMaterial.js';
import { atmosphereVertexShader, atmosphereFragmentShader } from './shaders.js';
import { getIPLocation, latLonToVector3, createMarker } from './utils.js';

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
// Start far away for "Deep Space"
camera.position.set(0, 0, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const state = {
    isIntroFinished: false,
    userLocation: null,
    earthRadius: 5
};

const textureLoader = new THREE.TextureLoader();

const earthGroup = new THREE.Group();
scene.add(earthGroup);

// Load textures with crossOrigin set (though redundant if loader handles it, good practice)
textureLoader.setCrossOrigin('anonymous');
const dayTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const nightTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png');
const bumpTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');

const earthGeometry = new THREE.SphereGeometry(state.earthRadius, 64, 64);
const earthMaterial = createEarthMaterial(dayTexture, nightTexture);
earthMaterial.normalMap = bumpTexture;
earthMaterial.normalScale = new THREE.Vector2(0.5, 0.5);

const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
earthGroup.add(earthMesh);

// Cloud Mesh
const cloudGeometry = new THREE.SphereGeometry(state.earthRadius * 1.01, 64, 64);
const cloudMaterial = new THREE.MeshStandardMaterial({
    map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png'),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
});
const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
earthGroup.add(cloudMesh);

// Atmosphere Glow Mesh
const atmosphereGeometry = new THREE.SphereGeometry(state.earthRadius * 1.25, 64, 64);
const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false
});
const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
scene.add(atmosphereMesh);


// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x050505);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(10, 5, 10);
scene.add(sunLight);

// --- Stars ---
function createStars() {
    const geometry = new THREE.BufferGeometry();
    const count = 5000;
    const positions = new Float32Array(count * 3);
    for(let i=0; i<count*3; i++) {
        positions[i] = (Math.random() - 0.5) * 400;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ size: 0.2, color: 0xffffff, transparent: true, opacity: 0.8 });
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
}
createStars();

// --- Sun Logic ---
function updateSun() {
    const now = new Date();
    // Simplified Sun Position Logic synced to UTC
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 1000 * 60 * 60 * 24);
    const declination = 23.44 * Math.sin((360/365) * (dayOfYear - 81) * (Math.PI/180));
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const sunLong = -(utcHours - 12) * 15 * (Math.PI / 180);
    const sunLat = declination * (Math.PI / 180);

    const r = 50;
    // Adjusting coordinate system to match texture (Greenwich at +Z or -Z?)
    // Standard ThreeJS texture: Greenwich is usually at U=0.5.
    // In SphereGeometry, U goes 0->1 around Y axis.
    // 0 is usually +Z? No, typically +X or -Z.
    // We will assume standard equirectangular.
    // Let's assume +Z is Prime Meridian.

    const x = r * Math.cos(sunLat) * Math.sin(sunLong);
    const y = r * Math.sin(sunLat);
    const z = r * Math.cos(sunLat) * Math.cos(sunLong);

    sunLight.position.set(x, y, z);

    if (earthMaterial.userData.shader) {
        earthMaterial.userData.shader.uniforms.sunPosition.value.copy(sunLight.position);
    }
}

// --- Animation Sequence ---
function startSequence() {
    const tl = gsap.timeline();

    // Phase 1: Deep Space to Earth (0-5s)
    tl.to(camera.position, {
        z: 20,
        x: 0,
        y: 0,
        duration: 5,
        ease: "power2.out",
        onUpdate: () => {
             // Optional: Add some camera shake or slight rotation
        }
    });

    // Phase 2: Orbit (5-10s)
    tl.to(camera.position, {
        x: 15,
        z: 10,
        duration: 5,
        ease: "sine.inOut",
        onStart: () => {
             // Start fetching location now so it's ready
             getIPLocation().then(loc => {
                 state.userLocation = loc;
                 console.log("Location found:", loc);
                 addMarker(loc);
             }).catch(err => console.error(err));
        }
    });

    // Phase 3: Zoom to Location (10s+)
    tl.to(camera.position, {
        duration: 3,
        onStart: () => {
            if (state.userLocation) {
                const targetPos = latLonToVector3(state.userLocation.lat, state.userLocation.lon, state.earthRadius + 5); // +5 distance
                // Need to rotate camera to look at earth center from that position
                // Actually user said: "Zoom doucement... caméra en plongée au centre de l'écran"
                // So we move camera to a position above the location.

                // We need to animate camera position to `targetPos`
                // And ensure camera looks at (0,0,0) or the surface point?
                // "Plongée" means looking down. Looking at Earth center from surface normal is a perfect plunging view.

                gsap.to(camera.position, {
                    x: targetPos.x,
                    y: targetPos.y,
                    z: targetPos.z,
                    duration: 3,
                    ease: "power2.inOut",
                    onUpdate: () => camera.lookAt(0,0,0)
                });
            }
        }
    });
}

function addMarker(loc) {
    const pos = latLonToVector3(loc.lat, loc.lon, state.earthRadius);
    const marker = createMarker();
    marker.position.copy(pos);
    marker.lookAt(0, 0, 0); // Orient to center? No, orient away.
    marker.lookAt(pos.clone().multiplyScalar(2)); // Look away from center
    earthGroup.add(marker);
}

// Start
document.getElementById('loading').style.opacity = 0;
startSequence();


function animate() {
    requestAnimationFrame(animate);
    updateSun();
    cloudMesh.rotation.y += 0.0002;
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
