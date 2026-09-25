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
import { Scoreboard } from './scoreboard'
import { NetworkClient } from './network'
import { MAX_PLAYERS } from './shared/protocol'
import { RemotePlayers } from './remotePlayers'
import { TeamLabel } from './team'
import { KillFeed } from './killFeed'
import { HitFeedback } from './hitFeedback'

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

// Intensitäten erhöht (1.2 -> 1.8 / 2.2 -> 2.8): Nutzerfeedback, dass Kanten
// im Dämmerungslicht schwer zu erkennen waren. Zusammen mit den neuen
// Kanten-Outlines (siehe arena.ts, addEdgeOutline) sollte das die Lesbarkeit
// deutlich verbessern, ohne die Dusk-Stimmung komplett zu verlieren.
const ambientLight = new THREE.AmbientLight(Palette.ambientLight, 1.8)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(Palette.sunLight, 2.8)
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

// Im Singleplayer immer Team Blau (siehe team.ts) - die Ziel-Dummies stehen
// als Platzhalter für "das gegnerische Team" (Rot), damit sich der
// Kill-Counter schon jetzt sinnvoll testen lässt.
const player = new Player(camera, arena.solids, arena.ramps, 'blue')
// Zufälligen Spawn-Punkt wählen: aktuell nur kosmetisch relevant (man spawnt
// mal hier, mal dort), aber im Multiplayer bräuchte jeder Spieler ohnehin
// einen zufälligen/zugewiesenen Punkt aus genau dieser Liste.
const randomSpawnPoint =
  arena.spawnPoints[Math.floor(Math.random() * arena.spawnPoints.length)]
player.spawn(randomSpawnPoint)

// Eigene, sichtbare Spieler-Hülle (siehe playerAvatar.ts). Bewusst NICHT in
// arena.shootables aufgenommen - man soll sich nicht selbst treffen können.
// Man sieht sich selbst in der Ego-Perspektive nicht, aber die Hülle
// existiert und leitet Schaden an den Spieler weiter.
const playerAvatar = new PlayerAvatar(player.team)
playerAvatar.mesh.userData.damageable = player
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
const scoreboard = new Scoreboard()
const weapon = new Weapon(camera, scene, arena.shootables, player.team, (killerTeam) =>
  scoreboard.addKill(killerTeam)
)

// Ziel-Dummies nur im Singleplayer - online sind echte Gegner da.
function setTargetsActive(active: boolean) {
  for (const target of targets) {
    const index = arena.shootables.indexOf(target.mesh)
    if (active && index === -1) {
      scene.add(target.mesh)
      arena.shootables.push(target.mesh)
    } else if (!active && index !== -1) {
      scene.remove(target.mesh)
      arena.shootables.splice(index, 1)
    }
  }
}

const hitFeedback = new HitFeedback(
  document.querySelector<HTMLDivElement>('#hitmarker')!,
  document.querySelector<HTMLDivElement>('#damage-indicators')!,
  document.querySelector<HTMLDivElement>('#damage-vignette')!
)
const remotePlayers = new RemotePlayers(scene, arena.shootables, (id) => network.sendHit(id))
const network: NetworkClient = new NetworkClient({
  getLocalState: () => player.getNetworkState(),
  onWelcome: (team, spawnIndex, scores) => {
    player.team = team
    player.networkControlled = true
    weapon.shooterTeam = team
    playerAvatar.setTeam(team)
    player.spawn(arena.spawnPoints[spawnIndex])
    scoreboard.setScores(scores)
    setTargetsActive(false)
  },
  onSnapshot: (entries) => remotePlayers.applySnapshot(entries),
  onOwnVitals: (health, shield, spawnProtected) =>
    player.applyServerVitals(health, shield, spawnProtected),
  onKill: (killer, victim, scores) => {
    scoreboard.setScores(scores)
    if (killer === network.localId) hitFeedback.showHit(true)
    killFeed.add(killer, victim, network.localId)
  },
  onRespawn: (id, spawnIndex) => {
    if (id === network.localId) player.spawn(arena.spawnPoints[spawnIndex])
    else remotePlayers.handleRespawn(id)
  },
  onRemoteShot: (from, to) =>
    weapon.showRemoteTracer(
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z)
    ),
  onHurt: (by) => hitFeedback.showDamageFrom(remotePlayers.getPosition(by), camera),
  onDisconnect: () => {
    player.networkControlled = false
    player.spawnProtected = false
    setTargetsActive(true)
  },
})

weapon.onShot = (from, to) => network.sendShot(from, to)
weapon.onEnemyHit = (kill) => hitFeedback.showHit(kill)

// Nur im Dev-Server: Zugriff für automatisierte Browser-Tests, die sonst
// keinen Weg an den Spielzustand hätten.
if (import.meta.env.DEV) {
  Object.assign(window, { __dusk: { player, network, remotePlayers, camera, weapon, arena, lookControl, hitFeedback } })
}

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
    'Links: Joystick zum Bewegen (voll ausgelenkt = Sprinten) · Rechts: Wischen zum Umschauen · Buttons: Springen/Schießen/Nachladen/Ducken'
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
      crouchButton: document.querySelector<HTMLButtonElement>('#crouch-button')!,
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
const scoreRed = document.querySelector<HTMLSpanElement>('#score-red')!
const scoreBlue = document.querySelector<HTMLSpanElement>('#score-blue')!
const shieldBarFill = document.querySelector<HTMLDivElement>('#shield-bar-fill')!
const staminaBarFill = document.querySelector<HTMLDivElement>('#stamina-bar-fill')!
const netStatus = document.querySelector<HTMLDivElement>('#net-status')!
const spawnProtectionHud = document.querySelector<HTMLDivElement>('#spawn-protection')!
const killFeed = new KillFeed(document.querySelector<HTMLDivElement>('#kill-feed')!)

// Kostenloses Hosting schläft ein - der erste Verbindungsaufbau dauert
// dann bis zu ~1 Minute. Solange noch versucht wird, zeigt das HUD das
// statt eines zwischen den Versuchen kurz aufblitzenden "Offline" an.
const WAKE_HINT_AFTER_MS = 5000
const GIVE_UP_HINT_AFTER_MS = 90000

function updateNetStatusHud() {
  const tryingFor =
    network.connectingSince === null ? null : performance.now() - network.connectingSince
  let trying = 'Offline · Singleplayer'
  if (tryingFor !== null && tryingFor < WAKE_HINT_AFTER_MS) trying = 'Verbinde…'
  else if (tryingFor !== null && tryingFor < GIVE_UP_HINT_AFTER_MS) trying = 'Server wird geweckt… (bis ~1 Min.)'

  const labels = {
    offline: trying,
    connecting: trying,
    online: `Online · ${network.playerCount}/${MAX_PLAYERS} Spieler · Team ${TeamLabel[player.team]}`,
    full: 'Server voll · Singleplayer',
    outdated: 'Veraltete Version · bitte neu laden',
  }
  netStatus.textContent = labels[network.status]
  netStatus.dataset.status = network.status
}

function updateScoreboardHud() {
  scoreRed.textContent = String(scoreboard.getScore('red'))
  scoreBlue.textContent = String(scoreboard.getScore('blue'))
}

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

  spawnProtectionHud.classList.toggle('hidden', !player.spawnProtected || !player.isAlive)
  deathOverlay.classList.toggle('hidden', player.isAlive)
  if (!player.isAlive) {
    respawnCountdown.textContent = String(Math.ceil(player.getRespawnCountdown()))
  }
}

function updateShieldAndStaminaHud() {
  const shield = player.getShieldState()
  shieldBarFill.style.width = `${(shield.current / shield.max) * 100}%`

  const stamina = player.getStaminaState()
  staminaBarFill.style.width = `${(stamina.current / stamina.max) * 100}%`
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
  playerAvatar.applyState(player.getNetworkState())
  remotePlayers.update(deltaSeconds, network.remotePlayers)
  killFeed.update()
  hitFeedback.update()
  updateAmmoHud()
  updateHealthHud()
  updateShieldAndStaminaHud()
  updateScoreboardHud()
  updateNetStatusHud()

  renderer.render(scene, camera)
}

animate()
