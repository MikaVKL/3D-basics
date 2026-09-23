import * as THREE from 'three'
import './style.css'
import { Palette } from './palette'
import { buildArena } from './arena'
import { Player } from './player'

// ---------------------------------------------------------------------------
// Grundgerüst: Szene, Kamera, Renderer
// ---------------------------------------------------------------------------

const scene = new THREE.Scene()
scene.background = new THREE.Color(Palette.sky)
scene.fog = new THREE.Fog(Palette.fog, 15, 45) // sorgt für einen weichen Horizont

const camera = new THREE.PerspectiveCamera(
  75, // Sichtfeld (FOV) - 75° ist ein typischer Wert für Ego-Shooter
  window.innerWidth / window.innerHeight,
  0.1,
  100
)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap // weiche, realistischere Schattenkanten

const appElement = document.querySelector<HTMLDivElement>('#app')!
appElement.appendChild(renderer.domElement)

// ---------------------------------------------------------------------------
// Beleuchtung
// ---------------------------------------------------------------------------
// Zwei Lichtquellen reichen für einen stimmungsvollen Look:
// - AmbientLight: gleichmäßige Grundhelligkeit, damit Schattenseiten nicht
//   komplett schwarz sind
// - DirectionalLight: simuliert Mond-/Abendlicht, wirft die eigentlichen
//   (weichen) Schatten und gibt den Objekten Tiefe

const ambientLight = new THREE.AmbientLight(Palette.ambientLight, 1.2)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(Palette.sunLight, 2.2)
sunLight.position.set(-15, 20, 10)
sunLight.castShadow = true
sunLight.shadow.mapSize.set(2048, 2048)
sunLight.shadow.camera.left = -25
sunLight.shadow.camera.right = 25
sunLight.shadow.camera.top = 25
sunLight.shadow.camera.bottom = -25
sunLight.shadow.camera.near = 1
sunLight.shadow.camera.far = 60
scene.add(sunLight)

// ---------------------------------------------------------------------------
// Arena aufbauen
// ---------------------------------------------------------------------------

const arena = buildArena()
scene.add(arena.group)

// ---------------------------------------------------------------------------
// Spieler (Kamera-Steuerung + Bewegung)
// ---------------------------------------------------------------------------

const player = new Player(camera, renderer.domElement, arena.solids)
player.spawn(arena.spawnPoint)
scene.add(player.controls.object)

// "Klicken zum Spielen"-Overlay: Pointer Lock funktioniert nur nach einer
// echten Nutzerinteraktion (Browser-Sicherheitsvorgabe), daher der Klick.
const overlay = document.querySelector<HTMLDivElement>('#overlay')!

overlay.addEventListener('click', () => {
  player.controls.lock()
})

player.controls.addEventListener('lock', () => {
  overlay.classList.add('hidden')
})

player.controls.addEventListener('unlock', () => {
  overlay.classList.remove('hidden')
})

// ---------------------------------------------------------------------------
// Fenstergröße ändern
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---------------------------------------------------------------------------
// Game Loop
// ---------------------------------------------------------------------------

const timer = new THREE.Timer()

function animate() {
  requestAnimationFrame(animate)

  timer.update()
  const deltaSeconds = Math.min(timer.getDelta(), 0.1) // Cap gegen Ausreißer bei Tab-Wechsel

  if (player.controls.isLocked) {
    player.update(deltaSeconds)
  }

  renderer.render(scene, camera)
}

animate()
