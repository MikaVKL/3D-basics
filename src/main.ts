import * as THREE from 'three'
import './style.css'
import { Palette } from './palette'
import { buildArena } from './arena'
import { Player } from './player'
import { LookControl } from './lookControl'
import { DesktopInput } from './input/DesktopInput'
import { TouchInput } from './input/TouchInput'

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
scene.add(camera)

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
// Spieler: Bewegung/Kollision (player) und Blickrichtung (lookControl) sind
// bewusst von der Eingabequelle getrennt - siehe DesktopInput/TouchInput.
// ---------------------------------------------------------------------------

const player = new Player(camera, arena.solids)
player.spawn(arena.spawnPoint)

const lookControl = new LookControl(camera)

// ---------------------------------------------------------------------------
// Eingabe: automatisch zwischen Maus+Tastatur (Desktop) und Touch (Tablet/
// Handy) wählen. `pointer: coarse` erkennt "ungenaue" Zeigegeräte (Finger)
// und ist zuverlässiger als reines Feature-Sniffing auf Touch-Events, da
// z.B. manche Laptops auch einen Touchscreen UND eine Maus haben.
// ---------------------------------------------------------------------------

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches

const overlay = document.querySelector<HTMLDivElement>('#overlay')!
const overlayInstruction = document.querySelector<HTMLParagraphElement>('#overlay-instruction')!
const overlayHint = document.querySelector<HTMLParagraphElement>('#overlay-hint')!
const touchControls = document.querySelector<HTMLDivElement>('#touch-controls')!

let isActive = false

function setActive(active: boolean) {
  isActive = active
  overlay.classList.toggle('hidden', active)
}

if (isTouchDevice) {
  overlayInstruction.textContent = 'Tippen, um zu spielen'
  overlayHint.textContent = 'Links: Joystick zum Bewegen · Rechts: Wischen zum Umschauen · Button: Springen'
  touchControls.classList.remove('hidden')

  const touchInput = new TouchInput(
    {
      moveZone: document.querySelector<HTMLDivElement>('#touch-move-zone')!,
      lookZone: document.querySelector<HTMLDivElement>('#touch-look-zone')!,
      joystickBase: document.querySelector<HTMLDivElement>('#joystick-base')!,
      joystickThumb: document.querySelector<HTMLDivElement>('#joystick-thumb')!,
      jumpButton: document.querySelector<HTMLButtonElement>('#jump-button')!,
    },
    player,
    lookControl
  )
  void touchInput // wird nur über die registrierten Event-Listener genutzt

  overlay.addEventListener('click', () => setActive(true))
} else {
  const desktopInput = new DesktopInput(renderer.domElement, player, lookControl, (locked) => {
    setActive(locked)
  })

  overlay.addEventListener('click', () => desktopInput.requestActivation())
}

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

  if (isActive) {
    player.update(deltaSeconds)
  }

  renderer.render(scene, camera)
}

animate()
