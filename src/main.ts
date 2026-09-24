import * as THREE from 'three'
import './style.css'
import { Palette } from './palette'
import { buildArena } from './arena'
import { Player } from './player'
import { LookControl } from './lookControl'
import { DesktopInput } from './input/DesktopInput'
import { TouchInput } from './input/TouchInput'
import { Weapon } from './weapon'
import { Target } from './target'
import { PlayerAvatar } from './playerAvatar'
import { DebugMarkers } from './debugMarkers'

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
// Entwickler-Debug-Modus: macht normalerweise unsichtbare Dinge sichtbar
// (aktuell Spawn-Punkte, später z.B. Team-Spawnzonen) - Taste F1 schaltet
// um. Rein zum Entwickeln gedacht, siehe debugMarkers.ts für Details. Am
// Ende der Entwicklung kann dieser ganze Block einfach entfernt werden.
// ---------------------------------------------------------------------------

const debugMarkers = new DebugMarkers(scene)
arena.spawnPoints.forEach((point, index) => debugMarkers.addSpawnPoint(point, index))

window.addEventListener('keydown', (event) => {
  if (event.code === 'F1') {
    event.preventDefault()
    debugMarkers.toggle()
  }
})

// ---------------------------------------------------------------------------
// Ziele zum Testen von Treffererkennung/Schaden (10 Treffer = "Tod",
// respawnen nach ein paar Sekunden automatisch wieder).
// ---------------------------------------------------------------------------

const targets = [
  new Target(new THREE.Vector3(3, 0.8, -6)),
  new Target(new THREE.Vector3(-3, 0.8, 6)),
]
for (const target of targets) {
  scene.add(target.mesh)
  arena.shootables.push(target.mesh)
}

// ---------------------------------------------------------------------------
// Spieler: Bewegung/Kollision (player) und Blickrichtung (lookControl) sind
// bewusst von der Eingabequelle getrennt - siehe DesktopInput/TouchInput.
// ---------------------------------------------------------------------------

const player = new Player(camera, arena.solids, arena.ramps)
// Zufälligen Spawn-Punkt wählen: aktuell nur kosmetisch relevant (man spawnt
// mal hier, mal dort), aber im Multiplayer bräuchte jeder Spieler ohnehin
// einen zufälligen/zugewiesenen Punkt aus genau dieser Liste.
const randomSpawnPoint =
  arena.spawnPoints[Math.floor(Math.random() * arena.spawnPoints.length)]
player.spawn(randomSpawnPoint)

// Sichtbare Spieler-Hülle (Vorbereitung für Multiplayer, siehe playerAvatar.ts).
// Bewusst NICHT in arena.shootables aufgenommen - man soll sich nicht selbst
// treffen können. Man sieht sich selbst in der Ego-Perspektive nicht, aber
// die Hülle existiert schon und reagiert korrekt auf Schaden.
const playerAvatar = new PlayerAvatar(player)
scene.add(playerAvatar.mesh)

// TEMPORÄR: statische Kopie der Spieler-Hülle in einer Arena-Ecke, nur damit
// das Modell direkt begutachtet werden kann (man sieht sich selbst sonst nie,
// da man immer aus der Ego-Perspektive schaut). Kann wieder entfernt werden,
// sobald das Modell überprüft wurde.
const inspectionAvatarMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.35, 1.0, 4, 8),
  new THREE.MeshStandardMaterial({ color: Palette.accentWarm })
)
inspectionAvatarMesh.position.set(16, 0.85, 16) // Ecke der Arena (halbe Kantenlänge = 20)
scene.add(inspectionAvatarMesh)

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
    'Links: Joystick zum Bewegen · Rechts: Wischen zum Umschauen · Buttons: Springen/Schießen/Nachladen'
  touchControls.classList.remove('hidden')

  const touchInput = new TouchInput(
    {
      moveZone: document.querySelector<HTMLDivElement>('#touch-move-zone')!,
      lookZone: document.querySelector<HTMLDivElement>('#touch-look-zone')!,
      joystickBase: document.querySelector<HTMLDivElement>('#joystick-base')!,
      joystickThumb: document.querySelector<HTMLDivElement>('#joystick-thumb')!,
      jumpButton: document.querySelector<HTMLButtonElement>('#jump-button')!,
      shootButton: document.querySelector<HTMLButtonElement>('#shoot-button')!,
      reloadButton: document.querySelector<HTMLButtonElement>('#reload-button')!,
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
const healthBarFill = document.querySelector<HTMLDivElement>('#health-bar-fill')!
const healthText = document.querySelector<HTMLSpanElement>('#health-text')!
const deathOverlay = document.querySelector<HTMLDivElement>('#death-overlay')!
const respawnCountdown = document.querySelector<HTMLSpanElement>('#respawn-countdown')!

function updateAmmoHud() {
  const ammo = weapon.getAmmoState()
  ammoHud.textContent = ammo.reloading ? 'Nachladen...' : `${ammo.current} / ${ammo.max}`
  ammoHud.classList.toggle('reloading', ammo.reloading)
}

function updateHealthHud() {
  const health = player.getHealthState()
  const ratio = health.current / health.max
  healthBarFill.style.width = `${ratio * 100}%`
  healthBarFill.classList.toggle('low', ratio <= 0.3)
  healthText.textContent = String(health.current)

  deathOverlay.classList.toggle('hidden', player.isAlive)
  if (!player.isAlive) {
    respawnCountdown.textContent = String(Math.ceil(player.getRespawnCountdown()))
  }
}

function animate() {
  requestAnimationFrame(animate)

  timer.update()
  const deltaSeconds = Math.min(timer.getDelta(), 0.1) // Cap gegen Ausreißer bei Tab-Wechsel

  if (isActive) {
    player.update(deltaSeconds)
  }
  weapon.update(deltaSeconds)
  for (const target of targets) {
    target.update(deltaSeconds, camera)
  }
  playerAvatar.update()
  updateAmmoHud()
  updateHealthHud()

  renderer.render(scene, camera)
}

animate()
