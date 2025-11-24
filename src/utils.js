// src/utils.js
import * as THREE from 'three';

export function getIPLocation() {
    return fetch('https://ipapi.co/json/')
        .then(res => res.json())
        .then(data => {
            if (data.latitude && data.longitude) {
                return { lat: data.latitude, lon: data.longitude, city: data.city };
            }
            throw new Error('Location not found');
        });
}

export function latLonToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    // Standard texture mapping fix might be needed here.
    // Three.js Sphere:
    // U: 0..1 goes 0..360 around Y. Starting at +Z usually?
    // Let's assume standard mapping:
    // x = -r * sin(phi) * cos(theta)
    // z = r * sin(phi) * sin(theta)
    // y = r * cos(phi)

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));

    return new THREE.Vector3(x, y, z);
}

export function createMarker() {
    // Create a glowing red marker
    const geometry = new THREE.SphereGeometry(0.05, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const marker = new THREE.Mesh(geometry, material);

    // Add a glow ring
    const ringGeo = new THREE.RingGeometry(0.08, 0.1, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.lookAt(new THREE.Vector3(0, 1, 0)); // Align roughly

    const group = new THREE.Group();
    group.add(marker);
    group.add(ring);

    // Pulse animation
    // We can use GSAP on the group.scale or ring opacity later

    return group;
}
