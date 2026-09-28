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
import { TeamColor, TeamLabel, type Team } from './team'
import { KillFeed } from './killFeed'
import { HitFeedback } from './hitFeedback'
import { ScoreTable } from './scoreTable'
import { SoundFx } from './sound'
import { Effects, CameraShake, SlideView } from './effects'
import { WEAPONS, WEAPON_SLOTS, type WeaponId } from './shared/weapons'
import { weaponIcon } from './weaponIcons'

// --- Grundgerüst: Szene, Kamera, Renderer ---

const scene = new THREE.Scene()
scene.background = new THREE.Color(Palette.sky)
scene.fog = new THREE.Fog(Palette.fog, 15, 45)

const camera = new THREE.PerspectiveCamera(
  75, // FOV
  window.innerWidth / window.innerHeight,
  0.1,
  100
)
scene.add(camera)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)
// Bewusst ohne Schlagschatten (wirkten unpassend); Flächen bleiben durch
// die Schattierung des gerichteten Lichts unterscheidbar

const appElement = document.querySelector<HTMLDivElement>('#app')!
appElement.appendChild(renderer.domElement)

// --- Beleuchtung ---
// Grundhelligkeit + gerichtetes Abendlicht; so hell, dass Kanten im
// Dämmerlicht noch gut erkennbar sind
const ambientLight = new THREE.AmbientLight(Palette.ambientLight, 1.8)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(Palette.sunLight, 2.8)
sunLight.position.set(-15, 20, 10)
scene.add(sunLight)

// --- Arena aufbauen ---

const arena = buildArena()
scene.add(arena.group)

// --- Debug-Modus (F1): zeigt Spawn-Punkte, nur zum Entwickeln ---

const debugMarkers = new DebugMarkers(scene)
arena.spawnPoints.forEach((point, index) => debugMarkers.addSpawnPoint(point, index))

window.addEventListener('keydown', (event) => {
  if (event.code === 'F1') {
    event.preventDefault()
    debugMarkers.toggle()
  }
})

// --- Ziel-Dummies (nur Singleplayer, respawnen automatisch) ---

const targets = [
  new Target(new THREE.Vector3(3, 0.8, -6)),
  new Target(new THREE.Vector3(-3, 0.8, 6)),
]
const effects = new Effects(scene)
const cameraShake = new CameraShake()
const slideView = new SlideView(camera)
for (const target of targets) {
  scene.add(target.mesh)
  arena.shootables.push(target.mesh)
  target.onDeath = (position) => effects.deathBurst(position, position.y - 0.8, TeamColor.red)
}

// --- Spieler (unabhängig von der Eingabequelle, siehe input/) ---

// Singleplayer: Team Blau gegen die roten Dummies; online teilt der Server zu
const player = new Player(camera, arena.solids, arena.ramps, 'blue')
const randomSpawnPoint =
  arena.spawnPoints[Math.floor(Math.random() * arena.spawnPoints.length)]
player.spawn(randomSpawnPoint)

// Eigene Figur: nicht in der Szene (die Kamera säße im Kopf) und nicht in
// shootables; hält nur Team und Zustand
const playerAvatar = new PlayerAvatar(player.team)
playerAvatar.mesh.userData.damageable = player


const lookControl = new LookControl(camera)
const scoreboard = new Scoreboard()
const weapon = new Weapon(camera, scene, arena.shootables, player.team, (killerTeam) =>
  scoreboard.addKill(killerTeam)
)

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

function setLocalTeam(team: Team) {
  player.team = team
  weapon.shooterTeam = team
  playerAvatar.setTeam(team)
}

const roundBanner = document.querySelector<HTMLDivElement>('#round-banner')!
const roundWinner = document.querySelector<HTMLDivElement>('#round-winner')!
const roundCountdown = document.querySelector<HTMLDivElement>('#round-countdown')!
const scoreGoal = document.querySelector<HTMLDivElement>('#score-goal')!
// Zeitpunkt der nächsten Runde (nur während der Sieger-Anzeige)
let nextRoundAt: number | null = null

const sound = new SoundFx()
const SHOT_SOUNDS = { pistol: 'shot', rifle: 'rifleShot', knife: 'knife' } as const
const hitFeedback = new HitFeedback(
  document.querySelector<HTMLDivElement>('#hitmarker')!,
  document.querySelector<HTMLDivElement>('#damage-indicators')!,
  document.querySelector<HTMLDivElement>('#damage-vignette')!
)
const remotePlayers = new RemotePlayers(scene, arena.shootables, (id, headshot) =>
  network.sendHit(id, headshot)
)
// localStorage kann werfen (privater Modus) - dann ohne gemerkten Namen
const NAME_STORAGE_KEY = 'duskArena.name'
const nameInput = document.querySelector<HTMLInputElement>('#name-input')!
try {
  nameInput.value = localStorage.getItem(NAME_STORAGE_KEY) ?? ''
} catch {
  // ignorieren
}
// Klick ins Feld soll nicht das Spiel starten (Overlay-Klick)
nameInput.addEventListener('click', (event) => event.stopPropagation())
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') nameInput.blur()
})
nameInput.addEventListener('change', () => {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, nameInput.value.trim())
  } catch {
    // ignorieren
  }
  network.sendName(nameInput.value)
})

const network: NetworkClient = new NetworkClient({
  getLocalState: () => player.getNetworkState(),
  getName: () => nameInput.value,
  onWelcome: (team, spawnIndex, scores, killsToWin) => {
    scoreGoal.textContent = `Erstes Team mit ${killsToWin} Kills gewinnt`
    setLocalTeam(team)
    player.networkControlled = true
    player.spawn(arena.spawnPoints[spawnIndex])
    scoreboard.setScores(scores)
    setTargetsActive(false)
  },
  onSnapshot: (entries) => remotePlayers.applySnapshot(entries),
  onOwnVitals: (health, shield, spawnProtected) =>
    player.applyServerVitals(health, shield, spawnProtected),
  onKill: (killer, victim, scores, headshot, killWeapon) => {
    if (victim === network.localId) {
      cameraShake.shake(0.18, 0.45)
    } else {
      const ground = remotePlayers.getGroundPosition(victim)
      const team = network.roster.get(victim)?.team
      if (ground && team) effects.deathBurst(ground, ground.y, TeamColor[team])
    }
    scoreboard.setScores(scores)
    if (killer === network.localId) {
      hitFeedback.showHit(true)
      sound.play('kill')
    }
    killFeed.add(killer, victim, killWeapon, headshot, network.localId, (id) => network.nameOf(id))
  },
  onRespawn: (id, spawnIndex, team) => {
    if (id === network.localId) {
      // Team-Ausgleich: der Server kann uns per Respawn die Seite wechseln lassen
      if (team !== player.team) setLocalTeam(team)
      player.spawn(arena.spawnPoints[spawnIndex])
    } else {
      remotePlayers.handleRespawn(id)
    }
  },
  onRoundEnd: (winner, nextRoundIn) => {
    roundBanner.className = winner
    roundWinner.textContent = `Team ${TeamLabel[winner]} gewinnt!`
    nextRoundAt = performance.now() + nextRoundIn * 1000
  },
  onRoundStart: (scores) => {
    scoreboard.setScores(scores)
    nextRoundAt = null
    roundBanner.classList.add('hidden')
  },
  onRemoteShot: (from, to, hit, shotWeapon) => {
    if (shotWeapon === 'knife') {
      sound.playAt('knife', from, 0.8)
      return
    }
    sound.playAt(SHOT_SOUNDS[shotWeapon], from, 0.8)
    effects.muzzleFlash(new THREE.Vector3(from.x, from.y, from.z))
    if (hit) effects.impactSparks(new THREE.Vector3(to.x, to.y, to.z))
    weapon.showRemoteTracer(
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z)
    )
  },
  onHurt: (by) => {
    hitFeedback.showDamageFrom(remotePlayers.getPosition(by), camera)
    sound.play('hurt')
    cameraShake.shake(0.06, 0.18)
  },
  onKicked: () => {
    // Zurück auf den Startbildschirm; erneuter Klick tritt wieder bei
    if (document.pointerLockElement) document.exitPointerLock()
    setActive(false)
    cancelLeave()
    overlayNotice.textContent = 'Wegen Inaktivität aus dem Spiel genommen - klicken, um wieder beizutreten'
  },
  onDisconnect: () => {
    nextRoundAt = null
    roundBanner.classList.add('hidden')
    player.networkControlled = false
    player.spawnProtected = false
    setTargetsActive(true)
  },
})

weapon.onShot = (from, to, hit) => {
  network.sendShot(from, to, hit)
  sound.play(SHOT_SOUNDS[weapon.current], 0.7)
  effects.muzzleFlash(from)
  if (hit) effects.impactSparks(to)
}
weapon.onEnemyHit = (kill, point, damage, headshot) => {
  hitFeedback.showHit(kill)
  hitFeedback.showDamageNumber(point, damage, headshot, camera)
  sound.play(kill ? 'kill' : headshot ? 'headshot' : 'hit')
}
weapon.onReload = () => sound.play('reload', 0.6)
weapon.onSwing = () => {
  sound.play('knife', 0.7)
  // Für den Ton bei den anderen (keine Leuchtspur)
  network.sendShot(camera.position, camera.position, false)
}
weapon.onSwitch = (id) => {
  player.weapon = id
}
remotePlayers.onFootstep = (position) => sound.playAt('step', position, 0.8)
player.onJump = () => sound.play('jump', 0.5)
player.onSlide = () => sound.play('slide', 0.6)
// Kleine Höhenwechsel (Rampe runter) sind keine Landung
player.onLand = (fallSpeed) => {
  if (fallSpeed > 3) sound.play('land', Math.min(1, fallSpeed / 10))
}

// M schaltet den Ton um (nicht beim Tippen im Namensfeld)
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM' && !(event.target instanceof HTMLInputElement)) sound.toggleMute()
})

// Nur im Dev-Build: Zugriff für die Browser-Tests (tests/)
if (import.meta.env.DEV) {
  Object.assign(window, { __dusk: { player, network, remotePlayers, camera, weapon, arena, lookControl, hitFeedback, sound, effects, cameraShake, slideView } })
}

// --- Eingabe ---
// `pointer: coarse` erkennt Finger-Geräte zuverlässiger als Touch-Events
// (manche Laptops haben Touchscreen UND Maus)

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches

const overlay = document.querySelector<HTMLDivElement>('#overlay')!
const overlayInstruction = document.querySelector<HTMLParagraphElement>('#overlay-instruction')!
const overlayHint = document.querySelector<HTMLParagraphElement>('#overlay-hint')!
const overlayNotice = document.querySelector<HTMLParagraphElement>('#overlay-notice')!
const touchControls = document.querySelector<HTMLDivElement>('#touch-controls')!

let isActive = false

// Im Menü oder bei App-/Tab-Wechsel verlässt man das Spiel nach dieser Zeit
const LEAVE_AFTER_MENU_MS = 20000
let leaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleLeave() {
  if (leaveTimer === null) leaveTimer = setTimeout(() => network.leave(), LEAVE_AFTER_MENU_MS)
}

function cancelLeave() {
  if (leaveTimer !== null) clearTimeout(leaveTimer)
  leaveTimer = null
}

function setActive(active: boolean) {
  isActive = active
  overlay.classList.toggle('hidden', active)
  if (active) {
    sound.unlock()
    overlayNotice.textContent = ''
    cancelLeave()
    network.join()
  } else {
    scheduleLeave()
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) scheduleLeave()
  else if (isActive) {
    cancelLeave()
    network.join()
  }
})

if (isTouchDevice) {
  overlayInstruction.textContent = 'Tippen, um zu spielen'
  overlayHint.textContent =
    'Links: Joystick zum Bewegen (voll ausgelenkt = Sprinten) · Rechts: Wischen zum Umschauen · Buttons: Springen/Schießen/Nachladen/Ducken/Waffe wechseln · Punktestand oben antippen: Tabelle'
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
      switchButton: document.querySelector<HTMLButtonElement>('#switch-button')!,
    },
    player,
    lookControl,
    weapon
  )
  void touchInput // arbeitet über seine Event-Listener

  overlay.addEventListener('click', () => setActive(true))
} else {
  const desktopInput = new DesktopInput(renderer.domElement, player, lookControl, weapon, (locked) => {
    setActive(locked)
  })

  overlay.addEventListener('click', () => desktopInput.requestActivation())
}

// --- Fenstergröße ändern ---

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Game Loop ---

const timer = new THREE.Timer()
const ammoHud = document.querySelector<HTMLDivElement>('#ammo-hud')!
const ammoCurrent = document.querySelector<HTMLSpanElement>('#ammo-current')!
const ammoMax = document.querySelector<HTMLSpanElement>('#ammo-max')!
const weaponName = document.querySelector<HTMLDivElement>('#weapon-name')!
const weaponCurrentIcon = document.querySelector<HTMLSpanElement>('#weapon-current-icon')!
const reloadBar = document.querySelector<HTMLDivElement>('#reload-bar')!
const reloadBarFill = document.querySelector<HTMLDivElement>('#reload-bar-fill')!
const healthBarFill = document.querySelector<HTMLDivElement>('#health-bar-fill')!
const healthText = document.querySelector<HTMLSpanElement>('#health-text')!
const shieldText = document.querySelector<HTMLSpanElement>('#shield-text')!
const deathOverlay = document.querySelector<HTMLDivElement>('#death-overlay')!
const respawnCountdown = document.querySelector<HTMLSpanElement>('#respawn-countdown')!
const scoreRed = document.querySelector<HTMLSpanElement>('#score-red')!
const scoreBlue = document.querySelector<HTMLSpanElement>('#score-blue')!
const shieldBarFill = document.querySelector<HTMLDivElement>('#shield-bar-fill')!
const staminaBarFill = document.querySelector<HTMLDivElement>('#stamina-bar-fill')!
const netStatus = document.querySelector<HTMLDivElement>('#net-status')!
const netText = document.querySelector<HTMLSpanElement>('#net-text')!
const netPing = document.querySelector<HTMLSpanElement>('#net-ping')!
const connectionWarning = document.querySelector<HTMLDivElement>('#connection-warning')!
// Server schickt 20x/s - so lange Stille ist kein normales Schwanken mehr
const CONNECTION_WARNING_AFTER_MS = 1500
const spawnProtectionHud = document.querySelector<HTMLDivElement>('#spawn-protection')!
const scoreTable = new ScoreTable(document.querySelector<HTMLDivElement>('#score-table')!)

// Tab halten zeigt die Tabelle (Fokuswechsel unterdrücken); Touch: Punktestand antippen
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Tab') return
  event.preventDefault()
  scoreTable.setVisible(true)
})
window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab') scoreTable.setVisible(false)
})
if (isTouchDevice) {
  const scoreboardElement = document.querySelector<HTMLDivElement>('#scoreboard')!
  scoreboardElement.style.pointerEvents = 'auto'
  scoreboardElement.addEventListener('click', () => scoreTable.setVisible(!scoreTable.visible))
}
const killFeed = new KillFeed(document.querySelector<HTMLDivElement>('#kill-feed')!)

// Gratis-Server braucht nach dem Einschlafen bis ~1 Min.; die Anzeige
// hängt an der Versuchsdauer, damit sie zwischen Versuchen nicht flackert
const WAKE_HINT_AFTER_MS = 5000
const GIVE_UP_HINT_AFTER_MS = 90000

function updateNetStatusHud() {
  const tryingFor =
    network.connectingSince === null ? null : performance.now() - network.connectingSince
  let trying = network.hasServer ? 'Nicht im Spiel · Singleplayer' : 'Offline · Singleplayer'
  if (tryingFor !== null && tryingFor < WAKE_HINT_AFTER_MS) trying = 'Verbinde…'
  else if (tryingFor !== null && tryingFor < GIVE_UP_HINT_AFTER_MS) trying = 'Server wird geweckt… (bis ~1 Min.)'

  const labels = {
    offline: trying,
    idle: network.hasServer ? 'Nicht im Spiel · „Spielen“ tritt bei' : trying,
    connecting: trying,
    online: `Online · ${network.playerCount}/${MAX_PLAYERS} Spieler · Team ${TeamLabel[player.team]}`,
    full: 'Server voll · Singleplayer',
    outdated: 'Veraltete Version · bitte neu laden',
  }
  netText.textContent = labels[network.status]
  netStatus.dataset.status = network.status
  const ping = network.status === 'online' ? network.ping : null
  netPing.textContent = ping === null ? '' : ` · ${ping} ms`
  netPing.dataset.quality = ping === null ? '' : ping < 80 ? 'good' : ping <= 150 ? 'ok' : 'bad'
  connectionWarning.classList.toggle('hidden', network.silentFor < CONNECTION_WARNING_AFTER_MS)
}

function updateRoundHud() {
  scoreGoal.classList.toggle('hidden', network.status !== 'online')
  if (nextRoundAt === null) return
  const seconds = Math.max(0, Math.ceil((nextRoundAt - performance.now()) / 1000))
  roundCountdown.textContent = `Nächste Runde in ${seconds}s`
}

function updateScoreboardHud() {
  scoreRed.textContent = String(scoreboard.getScore('red'))
  scoreBlue.textContent = String(scoreboard.getScore('blue'))
}

const weaponSlots = document.querySelector<HTMLDivElement>('#weapon-slots')!
const slotElements = WEAPON_SLOTS.map((id, index) => {
  const element = document.createElement('span')
  element.className = 'weapon-slot'
  element.dataset.weapon = id
  const key = document.createElement('span')
  key.className = 'slot-key'
  key.textContent = String(index + 1)
  element.append(key, weaponIcon(id, 0.75))
  weaponSlots.appendChild(element)
  return element
})
let shownWeapon: WeaponId | null = null

const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!
const CROSSHAIR_BASE_GAP = 4 // px
// Lücke = echte Streuung als Bildschirmabstand (Winkel -> Pixel über das FOV)
function updateCrosshair() {
  const melee = weapon.isMelee
  crosshair.classList.toggle('melee', melee)
  crosshair.classList.toggle('in-range', melee && player.isAlive && weapon.meleeTargetInRange())
  const pixelsPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const gap = CROSSHAIR_BASE_GAP + Math.tan(weapon.currentSpread) * pixelsPerRadian
  crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`)
}

function updateAmmoHud() {
  const ammo = weapon.getAmmoState()
  if (shownWeapon !== ammo.weapon) {
    shownWeapon = ammo.weapon
    WEAPON_SLOTS.forEach((id, index) => slotElements[index].classList.toggle('active', id === ammo.weapon))
    weaponName.textContent = WEAPONS[ammo.weapon].label
    weaponCurrentIcon.replaceChildren(weaponIcon(ammo.weapon, 1.5))
  }
  const melee = ammo.max === 0
  ammoCurrent.textContent = melee ? '—' : String(ammo.current)
  ammoMax.textContent = melee ? '' : ` / ${ammo.max}`
  ammoHud.classList.toggle('reloading', ammo.reloading)
  ammoHud.classList.toggle('empty', !melee && ammo.current === 0)
  reloadBar.classList.toggle('active', ammo.reloading)
  reloadBarFill.style.width = `${ammo.reloadProgress * 100}%`
}

// Treffer lassen Leben/Schild kurz aufblitzen
const BAR_FLASH_MS = 120
let lastVitals = 0
let barFlashUntil = 0

function updateHealthHud() {
  const health = player.getHealthState()
  const shield = player.getShieldState()
  const ratio = health.current / health.max
  const now = performance.now()
  const vitals = health.current + shield.current
  // Nur Schaden (Tod und Respawn setzen die Werte auch zurück)
  if (player.isAlive && vitals < lastVitals - 0.5) barFlashUntil = now + BAR_FLASH_MS
  lastVitals = vitals
  const flash = now < barFlashUntil
  healthBarFill.classList.toggle('flash', flash && health.current < health.max)
  shieldBarFill.classList.toggle('flash', flash && shield.current > 0)
  healthBarFill.style.width = `${ratio * 100}%`
  healthBarFill.classList.toggle('low', player.isAlive && ratio <= 0.3)
  healthText.textContent = String(Math.ceil(health.current))
  shieldText.textContent = String(Math.ceil(shield.current))

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

// Schritt-Geräusch pro zurückgelegter Strecke am Boden; geduckt lautlos
const STEP_DISTANCE = 2.2
let stepDistance = 0
const lastStepPosition = new THREE.Vector3()
function updateOwnFootsteps() {
  const moved = Math.hypot(camera.position.x - lastStepPosition.x, camera.position.z - lastStepPosition.z)
  lastStepPosition.copy(camera.position)
  if (!player.isOnGround || player.getNetworkState().crouching || moved > 1) return
  stepDistance += moved
  if (stepDistance >= STEP_DISTANCE) {
    stepDistance = 0
    sound.play('step', 0.5)
  }
}

let wasAlive = true
function animate() {
  requestAnimationFrame(animate)

  timer.update()
  const deltaSeconds = Math.min(timer.getDelta(), 0.1) // Deckel gegen Sprünge nach Tab-Wechsel

  if (isActive) {
    player.update(deltaSeconds)
    updateOwnFootsteps()
  }
  // Respawn (online wie offline): volle Magazine, Startwaffe
  if (player.isAlive && !wasAlive) weapon.resetLoadout()
  if (!player.isAlive) weapon.cancelFire()
  wasAlive = player.isAlive
  weapon.update(deltaSeconds)
  for (const target of targets) {
    target.update(deltaSeconds, camera)
  }
  playerAvatar.applyState(player.getNetworkState())
  remotePlayers.update(deltaSeconds, network.remotePlayers)
  sound.updateListener(camera)
  killFeed.update()
  hitFeedback.update()
  scoreTable.render(network.roster, network.localId)
  updateAmmoHud()
  updateCrosshair()
  updateHealthHud()
  updateShieldAndStaminaHud()
  updateScoreboardHud()
  updateNetStatusHud()
  updateRoundHud()

  effects.update(deltaSeconds)
  cameraShake.apply(camera, deltaSeconds)
  slideView.apply(camera, player.isSliding && player.isAlive, deltaSeconds)
  weapon.slideAmount = slideView.amount
  renderer.render(scene, camera)
  slideView.restore(camera)
  cameraShake.restore(camera)
}

animate()
