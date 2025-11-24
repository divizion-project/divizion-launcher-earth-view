import * as THREE from 'three';

const earthVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vSunDirection;

uniform vec3 sunDirection;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vSunDirection = normalize(sunDirection);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const earthFragmentShader = `
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D specularMap;
uniform sampler2D normalMap; // Note: Handling normal maps in custom shaders is complex, might rely on StandardMaterial extended or simplified bump
uniform vec3 sunDirection;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vSunDirection;

void main() {
    // Basic day color
    vec3 dayColor = texture2D(dayTexture, vUv).rgb;

    // Night lights
    vec3 nightColor = texture2D(nightTexture, vUv).rgb;

    // Calculate lighting
    // Simple lambert for mixing
    // In world space, the sun direction is uniform.
    // vNormal is view space. We need to be careful with spaces.
    // Usually easier to do calculation in View Space or World Space.
    // Let's assume passed sunDirection is in View Space or we handle it.

    // Actually, let's stick to a simpler approach:
    // Use MeshStandardMaterial and use onBeforeCompile to inject the night lights logic.
    // This keeps all the PBR goodness (bump, spec, atmosphere interaction) without rewriting the whole PBR shader.

    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); // Debug pink
}
`;

// Better approach: Extend MeshStandardMaterial
export function createEarthMaterial(dayTexture, nightTexture) {
    const material = new THREE.MeshStandardMaterial({
        map: dayTexture,
        roughness: 0.6,
        metalness: 0.1,
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.nightTexture = { value: nightTexture };
        shader.uniforms.sunPosition = { value: new THREE.Vector3(10, 0, 0) }; // Will be updated

        // Vertex Shader: Pass world position or normal to fragment
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vWorldNormal;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `
            #include <beginnormal_vertex>
            vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
            `
        );

        // Fragment Shader: Mix night lights
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform sampler2D nightTexture;
            uniform vec3 sunPosition;
            varying vec3 vWorldNormal;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #include <map_fragment>

            // Calculate Sun Direction (assuming sunPosition is World Space)
            vec3 sunDir = normalize(sunPosition);

            // Dot product
            float sunDot = dot(vWorldNormal, sunDir);

            // Smooth mix between day and night
            // if sunDot > 0.1 -> Day
            // if sunDot < -0.1 -> Night
            // Mix in between

            float mixFactor = smoothstep(-0.2, 0.2, sunDot);

            vec3 nightColor = texture2D(nightTexture, vUv).rgb;

            // Add night lights to the emissive part or directly modify diffuseColor
            // Note: diffuseColor is the base color before lighting.
            // We want the lights to appear even when unlit.

            // Emissive approach is best for lights
            // We can cheat by adding to outgoingLight at the end, or modifying totalEmissiveRadiance

            `
        );

        // Inject into lights_fragment_end or emissivemap_fragment
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>

            // If it is night (mixFactor is low), add night lights
            float nightIntensity = 1.0 - mixFactor;
            nightIntensity = pow(nightIntensity, 3.0); // Make transition sharper

            // Assuming the texture is black with lights
            totalEmissiveRadiance += nightColor * nightIntensity * 2.0;
            `
        );

        // Save reference to uniforms to update them later
        material.userData.shader = shader;
    };

    return material;
}
