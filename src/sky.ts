import * as THREE from 'three'
import { Palette } from './palette'

// Abendhimmel als Kuppel mit Farbverlauf (unten dämmrig-violett, oben
// tiefblau). Folgt der Kamera, damit man nie den Rand erreicht; ohne Nebel.
const SKY_RADIUS = 90 // innerhalb der Kamera-Sichtweite (far = 100)

export function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      horizon: { value: new THREE.Color(Palette.skyHorizon) },
      middle: { value: new THREE.Color(Palette.sky) },
      top: { value: new THREE.Color(Palette.skyTop) },
    },
    vertexShader: `
      varying float vHeight;
      void main() {
        vHeight = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 middle;
      uniform vec3 top;
      varying float vHeight;
      void main() {
        float h = max(vHeight, 0.0);
        vec3 color = mix(horizon, middle, smoothstep(0.0, 0.35, h));
        color = mix(color, top, smoothstep(0.35, 1.0, h));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material)
  sky.renderOrder = -1
  sky.frustumCulled = false
  return sky
}
