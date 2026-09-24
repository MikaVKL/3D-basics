import * as THREE from 'three'
import './style.css'
import { Palette } from './palette'
import { buildArena } from './arena'
import { Player } from './player'
import { LookControl } from './lookControl'
import { DesktopInput } from './input/DesktopInput'
import { TouchInput } from './input/TouchInput'
import { Weapon } from './weapon'

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
// Bewusst KEINE Schlagschatten (shadowMap): Bei einer einzelnen, festen
// Lichtquelle sahen die geworfenen Schatten seltsam/unpassend aus (keine
// erkennbare Korrespondenz zur Lichtposition). Die einzelnen Flächen von
// Wänden/Kisten bleiben trotzdem klar unterscheidbar, weil das
// direktionale Licht sie je nach Winkel unterschiedlich hell einfärbt -
// das ist normale Flächen-Schattierung, unabhängig von Schlagschatten.

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
const weapon = new Weapon(camera, scene, arena.shootables)

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
  overlayHint.textContent =
    'Links: Joystick zum Bewegen · Rechts: Wischen zum Umschauen · Buttons: Springen/Schießen ' +
    '(leeres Magazin lädt automatisch nach)'
  touchControls.classList.remove('hidden')

  const touchInput = new TouchInput(
    {
      moveZone: document.querySelector<HTMLDivElement>('#touch-move-zone')!,
      lookZone: document.querySelector<HTMLDivElement>('#touch-look-zone')!,
      joystickBase: document.querySelector<HTMLDivElement>('#joystick-base')!,
      joystickThumb: document.querySelector<HTMLDivElement>('#joystick-thumb')!,
      jumpButton: document.querySelector<HTMLButtonElement>('#jump-button')!,
      shootButton: document.querySelector<HTMLButtonElement>('#shoot-button')!,
    },
    player,
    lookControl,
    weapon
  )
  void touchInput // wird nur über die registrierten Event-Listener genutzt

  overlay.addEventListener('click', () => setActive(true))
} else {
  const desktopInput = new DesktopInput(renderer.domElement, player, lookControl, weapon, (locked) => {
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
const ammoHud = document.querySelector<HTMLDivElement>('#ammo-hud')!

function updateAmmoHud() {
  const ammo = weapon.getAmmoState()
  ammoHud.textContent = ammo.reloading ? 'Nachladen...' : `${ammo.current} / ${ammo.max}`
  ammoHud.classList.toggle('reloading', ammo.reloading)
}

function animate() {
  requestAnimationFrame(animate)

  timer.update()
  const deltaSeconds = Math.min(timer.getDelta(), 0.1) // Cap gegen Ausreißer bei Tab-Wechsel

  if (isActive) {
    player.update(deltaSeconds)
  }
  weapon.update(deltaSeconds)
  updateAmmoHud()

  renderer.render(scene, camera)
}

animate()
