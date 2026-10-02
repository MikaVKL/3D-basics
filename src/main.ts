import * as THREE from 'three'
import './style.css'
import { Palette } from './palette'
import { createSky } from './sky'
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
import { renderRoundStats } from './roundStats'
import { Minimap } from './minimap'
import { DEFAULT_SETTINGS, SETTING_RANGES, clampSetting, loadSettings, saveSettings, type NumericSettingKey } from './settings'
import { KillFeed } from './killFeed'
import { HitFeedback } from './hitFeedback'
import { ScoreTable } from './scoreTable'
import { SoundFx } from './sound'
import { Effects, CameraShake, SlideView } from './effects'
import { WEAPONS, type WeaponId } from './shared/weapons'
import { LoadoutScreen } from './loadoutScreen'
import { weaponIcon } from './weaponIcons'

// --- Grundgerüst: Szene, Kamera, Renderer ---

const scene = new THREE.Scene()
scene.background = new THREE.Color(Palette.sky)
const sky = createSky()
scene.add(sky)
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
const ambientLight = new THREE.AmbientLight(Palette.ambientLight, 1.0)
scene.add(ambientLight)
const skyLight = new THREE.HemisphereLight(0x9fb4d8, 0x1a1f2e, 1.4)
scene.add(skyLight)

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
const roundStatsElement = document.querySelector<HTMLDivElement>('#round-stats')!
const roundCountdown = document.querySelector<HTMLDivElement>('#round-countdown')!
const scoreGoal = document.querySelector<HTMLDivElement>('#score-goal')!
// Zeitpunkt der nächsten Runde (nur während der Sieger-Anzeige)
let nextRoundAt: number | null = null

const sound = new SoundFx()
const noticeBanner = document.querySelector<HTMLDivElement>('#notice-banner')!
const screenFade = document.querySelector<HTMLDivElement>('#screen-fade')!
const NOTICE_MS = 3500
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(text: string) {
  noticeBanner.textContent = text
  noticeBanner.classList.remove('hidden')
  if (noticeTimer !== null) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => noticeBanner.classList.add('hidden'), NOTICE_MS)
}
function fadeScreen() {
  screenFade.classList.remove('active')
  void screenFade.offsetWidth // Animation neu starten
  screenFade.classList.add('active')
}
const SHOT_SOUNDS = { pistol: 'shot', rifle: 'rifleShot', shotgun: 'shotgunShot', sniper: 'sniperShot', heavyPistol: 'heavyShot', smg: 'smgShot', knife: 'knife' } as const
const hitFeedback = new HitFeedback(
  document.querySelector<HTMLDivElement>('#hitmarker')!,
  document.querySelector<HTMLDivElement>('#damage-indicators')!,
  document.querySelector<HTMLDivElement>('#damage-vignette')!
)
const remotePlayers = new RemotePlayers(scene, arena.shootables, (id, headshot, pellets) =>
  network.sendHit(id, headshot, pellets)
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
  getLoadout: () => loadoutScreen.loadout,
  onWelcome: (team, spawnIndex, scores, killsToWin) => {
    scoreGoal.textContent = `Erstes Team mit ${killsToWin} Kills gewinnt`
    setLocalTeam(team)
    player.networkControlled = true
    // Beitritt setzt einen an einen Spawn - ohne Hinweis wirkte das wie ein
    // zufälliger Teleport (z. B. wenn der Server erst nach dem Start aufwacht)
    if (isActive) {
      fadeScreen()
      showNotice(`Online-Runde beigetreten · Team ${TeamLabel[team]}`)
    }
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
  onRoundEnd: (winner, nextRoundIn, stats) => {
    roundBanner.className = winner
    roundWinner.textContent = `Team ${TeamLabel[winner]} gewinnt!`
    renderRoundStats(roundStatsElement, stats, network.localId)
    nextRoundAt = performance.now() + nextRoundIn * 1000
  },
  onRoundStart: (scores) => {
    scoreboard.setScores(scores)
    nextRoundAt = null
    roundBanner.classList.add('hidden')
  },
  onRemoteShot: (from, to, hit, shotWeapon, shooter) => {
    if (shotWeapon === 'knife') {
      sound.playAt('knife', from, 0.8)
      return
    }
    sound.playAt(SHOT_SOUNDS[shotWeapon], from, 0.8)
    effects.muzzleFlash(new THREE.Vector3(from.x, from.y, from.z))
    if (hit) effects.impactSparks(new THREE.Vector3(to.x, to.y, to.z))
    weapon.showRemoteTracer(
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
      network.roster.get(shooter)?.team ?? 'red',
      shotWeapon
    )
  },
  onHurt: (by) => {
    hitFeedback.showDamageFrom(remotePlayers.getPosition(by), camera)
    sound.play('hurt')
    cameraShake.shake(0.06, 0.18)
  },
  onKicked: (reason) => {
    // Zurück auf den Startbildschirm; erneuter Klick tritt wieder bei
    if (document.pointerLockElement) document.exitPointerLock()
    setActive(false)
    cancelLeave()
    overlayNotice.textContent =
      reason === 'movement'
        ? 'Ungültige Bewegung erkannt - klicken, um wieder beizutreten'
        : 'Wegen Inaktivität aus dem Spiel genommen - klicken, um wieder beizutreten'
  },
  onCorrect: (position) => player.moveTo(new THREE.Vector3(position.x, position.y, position.z)),
  onDisconnect: () => {
    if (isActive && !document.hidden) showNotice('Verbindung zum Server verloren – Singleplayer, verbinde neu …')
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
  // Pumpgriff nach dem Schuss, solange noch Patronen drin sind und die Waffe in der Hand bleibt
  if (weapon.current === 'sniper') {
    setTimeout(() => {
      if (weapon.current === 'sniper' && weapon.getAmmoState().current > 0 && !weapon.getAmmoState().reloading) sound.play('sniperBolt', 0.5)
    }, 550)
  }
  if (weapon.current === 'shotgun') {
    setTimeout(() => {
      if (weapon.current === 'shotgun' && weapon.getAmmoState().current > 0 && !weapon.getAmmoState().reloading) sound.play('shotgunPump', 0.5)
    }, 400)
  }
}
weapon.onEnemyHit = (kill, point, damage, headshot) => {
  hitFeedback.showHit(kill)
  hitFeedback.showDamageNumber(point, damage, headshot, camera)
  sound.play(kill ? 'kill' : headshot ? 'headshot' : 'hit')
}
const RELOAD_SOUNDS = {
  pistol: ['reloadOut', 'reloadIn'],
  rifle: ['rifleReloadOut', 'rifleReloadIn'],
  shotgun: ['shotgunReloadOut', 'shotgunReloadIn'],
  sniper: ['sniperReloadOut', 'sniperReloadIn'],
  heavyPistol: ['heavyReloadOut', 'heavyReloadIn'],
  smg: ['smgReloadOut', 'smgReloadIn'],
  knife: ['reloadOut', 'reloadIn'],
} as const
weapon.onReload = () => sound.play(RELOAD_SOUNDS[weapon.current][0], 0.6)
weapon.onReloadDone = () => sound.play(RELOAD_SOUNDS[weapon.current][1], 0.6)
weapon.onDraw = (id) => sound.play(id === 'knife' ? 'drawKnife' : 'drawGun', 0.5)
weapon.onDryFire = () => sound.play('dryFire', 0.5)
weapon.onSwing = () => {
  sound.play('knife', 0.7)
  // Für den Ton bei den anderen (keine Leuchtspur)
  network.sendShot(camera.position, camera.position, false)
}
weapon.onSwitch = (id) => {
  player.weapon = id
}
remotePlayers.onFootstep = (position, sprinting) =>
  sound.playAt(position.y >= UPPER_FLOOR_FROM ? 'stepMetal' : 'step', position, sprinting ? 1 : 0.7)
player.onJump = () => sound.play('jump', 0.5)
player.onSlide = () => sound.play('slide', 0.6)
// Kleine Höhenwechsel (Rampe runter) sind keine Landung
player.onLand = (fallSpeed) => {
  if (fallSpeed > 3) sound.play(player.feetHeight >= UPPER_FLOOR_FROM ? 'landMetal' : 'land', Math.min(1, fallSpeed / 10))
}

// M schaltet den Ton um (nicht beim Tippen im Namensfeld)
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM' && !(event.target instanceof HTMLInputElement)) sound.toggleMute()
})

// Nur im Dev-Build: Zugriff für die Browser-Tests (tests/)
if (import.meta.env.DEV) {
  Object.assign(window, { __dusk: { player, network, remotePlayers, camera, weapon, arena, lookControl, hitFeedback, sound, effects, cameraShake, slideView, renderer } })
}

// --- Eingabe ---
// `pointer: coarse` erkennt Finger-Geräte zuverlässiger als Touch-Events
// (manche Laptops haben Touchscreen UND Maus)

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
const aimButtonEl = document.querySelector<HTMLButtonElement>('#aim-button')!

const overlay = document.querySelector<HTMLDivElement>('#overlay')!
const overlayInstruction = document.querySelector<HTMLParagraphElement>('#overlay-instruction')!
const overlayHint = document.querySelector<HTMLParagraphElement>('#overlay-hint')!
const overlayNotice = document.querySelector<HTMLParagraphElement>('#overlay-notice')!
const touchControls = document.querySelector<HTMLDivElement>('#touch-controls')!
const menuMain = document.querySelector<HTMLDivElement>('#menu-main')!
const menuSettings = document.querySelector<HTMLDivElement>('#menu-settings')!

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
    showSettings(false)
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

// Hauptmenü, Einstellungen und Waffenauswahl; Klick auf die Fläche daneben setzt nur
// das Hauptmenü fort (nach dem ersten Start), nicht aus den Einstellungen/der Auswahl heraus
let activate = () => setActive(true)

const menuLoadout = document.querySelector<HTMLDivElement>('#menu-loadout')!
const startButton = document.querySelector<HTMLButtonElement>('#start-button')!
const resumeButton = document.querySelector<HTMLButtonElement>('#resume-button')!
const loadoutOpenButton = document.querySelector<HTMLButtonElement>('#loadout-open-button')!
const loadoutScreen = new LoadoutScreen(
  document.querySelector<HTMLDivElement>('#loadout-primary')!,
  document.querySelector<HTMLDivElement>('#loadout-secondary')!
)
loadoutScreen.onChange = (loadout) => network.sendLoadout(loadout)
// Erster "Spielen"-Klick hat das Spiel gestartet: ab dann gibt es "Weiter" statt "Starten"
let started = false

function showScreen(screen: 'main' | 'settings' | 'loadout') {
  menuMain.classList.toggle('hidden', screen !== 'main')
  menuSettings.classList.toggle('hidden', screen !== 'settings')
  menuLoadout.classList.toggle('hidden', screen !== 'loadout')
  startButton.classList.toggle('hidden', started)
  resumeButton.classList.toggle('hidden', !started)
  loadoutOpenButton.classList.toggle('hidden', !started)
}

function showSettings(show: boolean) {
  showScreen(show ? 'settings' : 'main')
}

// Neues Leben (erster Start, Beitritt, Respawn): gewählte Waffen, volle Magazine, Secondary in der Hand
function startLife() {
  weapon.resetLoadout(loadoutScreen.loadout)
  player.weapon = weapon.current
  buildWeaponSlots()
}

function activateFromOverlay() {
  if (started && !menuMain.classList.contains('hidden')) activate()
}

startButton.addEventListener('click', (event) => {
  event.stopPropagation()
  showScreen('loadout')
})
loadoutOpenButton.addEventListener('click', (event) => {
  event.stopPropagation()
  showScreen('loadout')
})
document.querySelector('#loadout-back-button')!.addEventListener('click', (event) => {
  event.stopPropagation()
  showScreen('main')
})
document.querySelector('#loadout-play-button')!.addEventListener('click', (event) => {
  event.stopPropagation()
  if (!started) {
    started = true
    startLife()
  }
  activate()
})
resumeButton.addEventListener('click', (event) => {
  event.stopPropagation()
  activate()
})

document.querySelector('#settings-button')!.addEventListener('click', (event) => {
  event.stopPropagation()
  showSettings(true)
})
document.querySelector('#settings-back-button')!.addEventListener('click', (event) => {
  event.stopPropagation()
  showSettings(false)
})
menuSettings.addEventListener('click', (event) => event.stopPropagation())

// Minimap vor den Einstellungen: applySettings() blendet sie ein/aus
const minimap = new Minimap(document.querySelector<HTMLDivElement>('#minimap')!, arena.solids, arena.ramps)
if (import.meta.env.DEV) Object.assign((window as unknown as { __dusk: object }).__dusk, { minimap })

// --- Einstellungen: Regler im Menü, gemerkt im Browser ---
const settings = loadSettings()
const settingFormat: Record<NumericSettingKey, (value: number) => string> = {
  sensitivity: (value) => `${value.toFixed(2)}×`,
  fov: (value) => `${Math.round(value)}°`,
  volume: (value) => `${Math.round(value * 100)} %`,
  music: (value) => `${Math.round(value * 100)} %`,
}

function applySettings() {
  lookControl.setSensitivityScale(settings.sensitivity)
  camera.fov = settings.fov
  camera.updateProjectionMatrix()
  slideView.setBaseFov(settings.fov)
  sound.setVolume(settings.volume)
  sound.setMusicVolume(settings.music)
  minimap.setVisible(settings.minimap)
}

const settingSliders = {} as Record<NumericSettingKey, HTMLInputElement>
for (const key of Object.keys(SETTING_RANGES) as NumericSettingKey[]) {
  const slider = document.querySelector<HTMLInputElement>(`#setting-${key}`)!
  const output = document.querySelector<HTMLOutputElement>(`#setting-${key}-value`)!
  const { min, max, step } = SETTING_RANGES[key]
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)
  settingSliders[key] = slider
  slider.addEventListener('input', () => {
    settings[key] = clampSetting(key, Number(slider.value))
    output.textContent = settingFormat[key](settings[key])
    applySettings()
    saveSettings(settings)
  })
}

const minimapCheckbox = document.querySelector<HTMLInputElement>('#setting-minimap')!
const minimapCheckboxValue = document.querySelector<HTMLOutputElement>('#setting-minimap-value')!

function showSettingValues() {
  for (const key of Object.keys(settingSliders) as NumericSettingKey[]) {
    settingSliders[key].value = String(settings[key])
    document.querySelector(`#setting-${key}-value`)!.textContent = settingFormat[key](settings[key])
  }
  minimapCheckbox.checked = settings.minimap
  minimapCheckboxValue.textContent = settings.minimap ? 'An' : 'Aus'
}

function setMinimapEnabled(enabled: boolean) {
  settings.minimap = enabled
  showSettingValues()
  applySettings()
  saveSettings(settings)
}

minimapCheckbox.addEventListener('change', () => setMinimapEnabled(minimapCheckbox.checked))
// N schaltet die Karte um (nicht beim Tippen im Namensfeld)
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyN' && !event.repeat && !(event.target instanceof HTMLInputElement)) setMinimapEnabled(!settings.minimap)
})

document.querySelector('#settings-reset-button')!.addEventListener('click', (event) => {
  event.stopPropagation()
  Object.assign(settings, DEFAULT_SETTINGS)
  showSettingValues()
  applySettings()
  saveSettings(settings)
})

showSettingValues()
applySettings()

if (isTouchDevice) {
  overlayInstruction.textContent = 'Tippen, um zu spielen'
  overlayHint.textContent =
    'Links: Joystick zum Bewegen (voll ausgelenkt = Sprinten) · Rechts: Wischen zum Umschauen · Buttons: Springen (halten = weiterhüpfen) / Schießen (halten + wischen = zielen) / Nachladen / Ducken (halten) / Waffe wechseln · Punktestand oben antippen: Tabelle'
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
      aimButton: document.querySelector<HTMLButtonElement>('#aim-button')!,
    },
    player,
    lookControl,
    weapon
  )
  void touchInput // arbeitet über seine Event-Listener

  document.querySelector('#menu-button')!.addEventListener('click', () => setActive(false))
  overlay.addEventListener('click', activateFromOverlay)
} else {
  const desktopInput = new DesktopInput(renderer.domElement, player, lookControl, weapon, (locked) => {
    setActive(locked)
  })

  activate = () => desktopInput.requestActivation()
  overlay.addEventListener('click', activateFromOverlay)
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
    // Kleine Bildschirme: kurz, sonst stößt der Status an den Punktestand
    online:
      window.innerWidth < 760
        ? `${network.playerCount}/${MAX_PLAYERS} · Team ${TeamLabel[player.team]}`
        : `Online · ${network.playerCount}/${MAX_PLAYERS} Spieler · Team ${TeamLabel[player.team]}`,
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
let slotElements: HTMLElement[] = []
// Leiste nach den Tasten 1-3 (Primary, Secondary, Messer) neu aufbauen
function buildWeaponSlots() {
  weaponSlots.replaceChildren()
  slotElements = weapon.slots.map((id, index) => {
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
  shownWeapon = null
}
let shownWeapon: WeaponId | null = null
buildWeaponSlots()

const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!
const CROSSHAIR_BASE_GAP = 4 // px
// Lücke = echte Streuung als Bildschirmabstand (Winkel -> Pixel über das FOV)
const scopeOverlay = document.querySelector<HTMLDivElement>('#scope')!
function updateCrosshair() {
  // Zielfernrohr: Linsenbild statt Fadenkreuz
  const scope = player.isAlive ? weapon.scopeAmount : 0
  scopeOverlay.style.setProperty('--scope', scope.toFixed(2))
  crosshair.style.visibility = scope > 0.5 ? 'hidden' : ''
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
    weapon.slots.forEach((id, index) => slotElements[index].classList.toggle('active', id === ammo.weapon))
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
    sound.play(player.feetHeight >= UPPER_FLOOR_FROM ? 'stepMetal' : 'step', player.getNetworkState().sprinting ? 0.65 : 0.45)
  }
}

// --- Minimap: du und dein Team (keine Gegner), Erzeugung oben bei den Einstellungen ---
const minimapDirection = new THREE.Vector3()
const UPPER_FLOOR_FROM = 2 // Fußhöhe ab hier: obere Ebene

function updateMinimap() {
  if (!minimap.visible) return
  camera.getWorldDirection(minimapDirection)
  const mates = remotePlayers
    .positions()
    .filter((p) => p.alive && network.roster.get(p.id)?.team === player.team)
    .map((p) => ({ x: p.x, z: p.z, high: p.y > UPPER_FLOOR_FROM }))
  minimap.update(
    { x: camera.position.x, z: camera.position.z, dirX: minimapDirection.x, dirZ: minimapDirection.z, high: player.feetHeight > UPPER_FLOOR_FROM, team: player.team },
    mates
  )
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
  if (player.isAlive && !wasAlive) startLife()
  if (!player.isAlive) weapon.cancelFire()
  wasAlive = player.isAlive
  weapon.update(deltaSeconds)
  for (const target of targets) {
    target.update(deltaSeconds, camera)
  }
  playerAvatar.applyState(player.getNetworkState())
  remotePlayers.update(deltaSeconds, network.remotePlayers)
  updateMinimap()
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
  sky.position.copy(camera.position)
  cameraShake.apply(camera, deltaSeconds)
  // Zielen: Blickfeld zoomt, Empfindlichkeit und Tempo folgen
  slideView.zoom = weapon.zoomFactor
  lookControl.setZoomScale(Math.tan((settings.fov * weapon.zoomFactor * Math.PI) / 360) / Math.tan((settings.fov * Math.PI) / 360))
  if (isTouchDevice) {
    // Umschalter: Messer beendet das Zielen, sonst zoomt es beim Zurückwechseln unerwartet
    if (weapon.isMelee && weapon.aimRequested) weapon.setAiming(false)
    aimButtonEl.classList.toggle('active', weapon.aimRequested)
  }
  player.setAiming(weapon.isAiming)
  slideView.apply(camera, player.isSliding && player.isAlive, deltaSeconds)
  weapon.slideAmount = slideView.amount
  renderer.render(scene, camera)
  slideView.restore(camera)
  cameraShake.restore(camera)
}

animate()
