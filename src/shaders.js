export const atmosphereVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const atmosphereFragmentShader = `
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    // Calculate view direction in view space (camera is at 0,0,0)
    vec3 viewVector = normalize(-vPosition);

    // Fresnel effect based on view direction and normal
    // If normal points at camera, dot is 1. If edge, dot is 0.
    float viewDot = dot(vNormal, viewVector);

    // Invert for rim light: 1 at edge, 0 at center
    float intensity = pow(0.6 - viewDot, 4.0);

    // Clamp
    intensity = clamp(intensity, 0.0, 1.0);

    // Color gradient
    vec3 atmosphereColor = vec3(0.3, 0.6, 1.0);

    gl_FragColor = vec4(atmosphereColor, intensity * 1.5);
}
`;
