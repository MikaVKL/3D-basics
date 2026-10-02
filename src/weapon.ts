import * as THREE from 'three'
import { Palette } from './palette'
import { WeaponView } from './weaponView'
import type { Damageable } from './damageable'
import { TeamColor, type Team } from './team'
import { HEADSHOT_MULTIPLIER } from './shared/gameRules'
import { WEAPONS, WEAPON_SLOTS, DEFAULT_WEAPON, SWITCH_TIME, isMelee, type WeaponId } from './shared/weapons'

// Hitscan aus der Bildschirmmitte, mehrere Waffen mit eigener Munition,
// Nachladen, Wechsel, Dauerfeuer. Treffer laufen generisch über Damageable
// (Dummy oder fremder Spieler).

const IMPACT_MARKER_LIFETIME = 2 // Sekunden
// Strahl je Waffe: Pistole = kräftiger Einzelschuss, Sturmgewehr = dünne,
// kurze Salvenspur (sonst wird Dauerfeuer zum Strahlenteppich)
const TRACER_STYLES: Record<WeaponId, { lifetime: number; width: number; glow: number }> = {
  pistol: { lifetime: 0.2, width: 1.7, glow: 0.75 },
  rifle: { lifetime: 0.12, width: 0.6, glow: 0.35 },
  knife: { lifetime: 0.2, width: 1, glow: 0.5 }, // ungenutzt, Messer hat keinen Strahl
}
const TRACER_MAX_DISTANCE = 60 // bei Schuss ins Leere

// "Hitze" des Dauerfeuers: +1 pro Schuss, klingt so schnell ab (pro Sekunde).
// Die ersten Schüsse einer Salve treffen genau.
const HEAT_DECAY = 4
const PRECISE_SHOTS = 2
const AIM_BLEND_SPEED = 9 // pro Sekunde (~0,11 s bis ganz gezoomt)
const AIM_SPREAD_REDUCTION = 0.5 // beim Zielen halbe Streuung
// Dauerfeuer holt verpasste Schüsse nach (sonst hinge die Feuerrate an den
// FPS), aber höchstens so viel Rückstand
const MAX_FIRE_CATCHUP = 0.1 // Sekunden

export interface AmmoState {
  weapon: WeaponId
  current: number
  max: number
  reloading: boolean
  reloadProgress: number // 0..1 während des Nachladens
}

function fullMagazines(): Record<WeaponId, number> {
  const ammo = {} as Record<WeaponId, number>
  for (const id of WEAPON_SLOTS) ammo[id] = WEAPONS[id].magazine
  return ammo
}

interface ImpactMarker {
  mesh: THREE.Mesh
  remainingLifetime: number
}

interface Tracer {
  meshes: THREE.Mesh[]
  materials: THREE.MeshBasicMaterial[]
  peakOpacity: number[]
  remainingLifetime: number
  lifetime: number
}

export class Weapon {
  private raycaster = new THREE.Raycaster()
  private cooldownRemaining = 0
  private impactMarkers: ImpactMarker[] = []

  private markerGeometry = new THREE.SphereGeometry(0.04, 8, 8)
  private markerMaterial = new THREE.MeshBasicMaterial({
    color: Palette.accentNeon,
  })

  // Laserstrahl: heller Kern + Schein in Teamfarbe, 1 Einheit lange Zylinder,
  // pro Schuss per scale.y gestreckt
  private tracers: Tracer[] = []
  private tracerCoreGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 6)
  private tracerGlowGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 8)

  private camera: THREE.Camera
  private scene: THREE.Scene
  private shootables: THREE.Object3D[]
  private view: WeaponView
  // Online vom Server zugeteilt
  private team!: Team
  private onKill?: (killerTeam: Team) => void
  // Jeder Schuss (Mündung -> Einschlag), für die Leuchtspur bei anderen
  onShot?: (from: THREE.Vector3, to: THREE.Vector3, hit: boolean) => void
  // Für Hitmarker und Schadenszahl; kill nur lokal erkannt (Dummies), online meldet der Server
  onEnemyHit?: (kill: boolean, point: THREE.Vector3, damage: number, headshot: boolean) => void
  onReload?: () => void
  onReloadDone?: () => void
  onSwitch?: (weapon: WeaponId) => void
  // Neue Waffe ist in der Hand (Tiefpunkt des Wechsels): Ton fürs Ziehen
  onDraw?: (weapon: WeaponId) => void
  // Abdrücken, obwohl nicht geschossen werden kann (Nachladen)
  onDryFire?: () => void
  // Waffe, deren Modell gerade gezeigt wird; wechselt erst beim Tiefpunkt
  private pendingModel: WeaponId | null = null
  // 0..1, Waffe neigt sich beim Rutschen (setzt main.ts)
  slideAmount = 0
  // Messerstich (getroffen oder nicht), für den Ton
  onSwing?: () => void

  private weaponId: WeaponId = DEFAULT_WEAPON
  private previousWeapon: WeaponId = WEAPON_SLOTS[1]
  private ammoByWeapon = fullMagazines()
  private reloadRemaining = 0
  private switchRemaining = 0
  private triggerHeld = false
  // Klick während der Feuerpause: Schuss folgt, sobald sie vorbei ist
  private shotQueued = false
  private heat = 0
  // Zielen: gewünscht (Taste gehalten) und tatsächlich (0..1, blendet weich ein)
  private aimWanted = false
  aimAmount = 0

  get shooterTeam(): Team {
    return this.team
  }

  // Eigene Waffe leuchtet immer in der eigenen Teamfarbe (gegen Verwechslung)
  set shooterTeam(team: Team) {
    this.team = team
    this.view.setTeamColor(TeamColor[team])
  }

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    shootables: THREE.Object3D[],
    shooterTeam: Team,
    onKill?: (killerTeam: Team) => void
  ) {
    this.camera = camera
    this.scene = scene
    this.shootables = shootables
    this.view = new WeaponView(camera)
    this.shooterTeam = shooterTeam
    this.onKill = onKill
  }

  get current(): WeaponId {
    return this.weaponId
  }

  private get stats() {
    return WEAPONS[this.weaponId]
  }

  get ammo(): number {
    return this.ammoByWeapon[this.weaponId]
  }

  set ammo(value: number) {
    this.ammoByWeapon[this.weaponId] = value
  }

  switchTo(id: WeaponId) {
    if (id === this.weaponId) return
    this.previousWeapon = this.weaponId
    this.weaponId = id
    // Nachladen bricht ab (Munition bleibt wie sie war)
    this.reloadRemaining = 0
    this.switchRemaining = SWITCH_TIME
    this.heat = 0
    this.shotQueued = false
    // Zweiphasig: altes Modell sinkt, beim Tiefpunkt (update) kommt das neue
    this.pendingModel = id
    this.onSwitch?.(id)
  }

  // Mausrad: +1 = nächste Waffe
  cycle(direction: 1 | -1) {
    const index = WEAPON_SLOTS.indexOf(this.weaponId)
    this.switchTo(WEAPON_SLOTS[(index + direction + WEAPON_SLOTS.length) % WEAPON_SLOTS.length])
  }

  switchToPrevious() {
    this.switchTo(this.previousWeapon)
  }

  // Nach dem Respawn: alles voll, Startwaffe in der Hand
  resetLoadout() {
    this.ammoByWeapon = fullMagazines()
    this.switchTo(DEFAULT_WEAPON)
    this.previousWeapon = WEAPON_SLOTS[1]
    this.reloadRemaining = 0
    this.switchRemaining = 0
    // Kein Wechsel-Ablauf beim Respawn: Modell sofort, ohne Ton
    this.view.setWeapon(this.weaponId)
    this.pendingModel = null
    this.cancelFire()
  }

  // Tod, Menü: kein Weiterfeuern, kein vorgemerkter Schuss, kein Zielen
  cancelFire() {
    this.triggerHeld = false
    this.shotQueued = false
    this.aimWanted = false
  }

  setAiming(aiming: boolean) {
    this.aimWanted = aiming
  }

  // Zielen ist gewünscht (auch während Nachladen/Wechsel, wo es noch pausiert)
  get aimRequested(): boolean {
    return this.aimWanted
  }

  // Zielt gerade (gehalten, und weder Messer noch Wechsel/Nachladen)
  get isAiming(): boolean {
    return this.aimWanted && !this.isMelee && this.switchRemaining === 0 && this.reloadRemaining === 0
  }

  // Blickfeld-Faktor des aktuellen Zielens (1 = nicht gezoomt)
  get zoomFactor(): number {
    return 1 + (this.stats.aimZoom - 1) * this.aimAmount
  }

  // Gedrückt halten: Dauerfeuer nur bei automatischen Waffen
  setTrigger(pressed: boolean) {
    this.triggerHeld = pressed
    if (pressed && this.reloadRemaining > 0 && !this.isMelee) this.onDryFire?.()
    if (pressed && !this.tryShoot() && this.cooldownRemaining > 0) this.shotQueued = true
  }

  update(deltaSeconds: number) {
    const autoFire = this.triggerHeld && this.stats.automatic
    this.cooldownRemaining -= deltaSeconds
    if (!autoFire) this.cooldownRemaining = Math.max(0, this.cooldownRemaining)
    this.switchRemaining = Math.max(0, this.switchRemaining - deltaSeconds)
    this.heat = Math.max(0, this.heat - HEAT_DECAY * deltaSeconds)
    // Wechsel: oben -> unten (Tiefpunkt: Modell tauscht, Zieh-Ton) -> oben
    const switchProgress = this.switchRemaining / SWITCH_TIME
    if (this.pendingModel !== null && switchProgress <= 0.5) {
      this.view.setWeapon(this.pendingModel)
      this.onDraw?.(this.pendingModel)
      this.pendingModel = null
    }
    this.view.lowered = 1 - Math.abs(2 * switchProgress - 1)
    this.view.reload = this.reloadRemaining > 0 ? 1 - this.reloadRemaining / this.stats.reloadTime : 0
    this.view.slide = this.slideAmount
    const aimStep = AIM_BLEND_SPEED * deltaSeconds
    this.aimAmount += Math.min(aimStep, Math.max(-aimStep, (this.isAiming ? 1 : 0) - this.aimAmount))
    this.view.aim = this.aimAmount
    this.view.update(deltaSeconds)

    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - deltaSeconds)
      if (this.reloadRemaining === 0) {
        this.ammo = this.stats.magazine
        this.onReloadDone?.()
      }
    }
    if (this.shotQueued && this.cooldownRemaining <= 0) {
      this.shotQueued = false
      this.tryShoot()
    }
    while (autoFire && this.triggerHeld && this.cooldownRemaining <= 0 && this.tryShoot()) {
      // mehrere Schüsse in einem Bild bei niedriger Bildrate
    }

    for (let i = this.impactMarkers.length - 1; i >= 0; i--) {
      const marker = this.impactMarkers[i]
      marker.remainingLifetime -= deltaSeconds
      if (marker.remainingLifetime <= 0) {
        this.scene.remove(marker.mesh)
        this.impactMarkers.splice(i, 1)
      }
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i]
      tracer.remainingLifetime -= deltaSeconds
      if (tracer.remainingLifetime <= 0) {
        for (const mesh of tracer.meshes) this.scene.remove(mesh)
        for (const material of tracer.materials) material.dispose()
        this.tracers.splice(i, 1)
        continue
      }
      // Schnell hell, dann weich aus (quadratisch)
      const fade = (tracer.remainingLifetime / tracer.lifetime) ** 2
      tracer.materials.forEach((material, index) => (material.opacity = tracer.peakOpacity[index] * fade))
    }
  }

  // true = Schuss abgegeben
  tryShoot(): boolean {
    if (this.reloadRemaining > 0 || this.switchRemaining > 0) return false
    const melee = isMelee(this.weaponId)
    if (!melee && this.ammo <= 0) {
      this.reload()
      return false
    }
    if (this.cooldownRemaining > 0) return false

    this.cooldownRemaining = Math.max(this.cooldownRemaining, -MAX_FIRE_CATCHUP) + this.stats.fireInterval
    if (!melee) this.ammo -= 1
    this.view.playShootEffect()

    // matrixWorld wird sonst erst beim Rendern aktualisiert - ein Schuss
    // direkt nach einer Mausbewegung zielte noch in die alte Richtung
    this.camera.updateMatrixWorld()

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    this.raycaster.far = this.stats.range
    this.applySpread()
    this.heat += 1

    // Raycaster ignoriert "visible" nicht - tote Spieler fingen sonst Kugeln ab
    const hits = this.raycaster
      .intersectObjects(this.shootables, false)
      .filter((hit) => hit.object.visible)

    if (melee) {
      // Keine Leuchtspur, keine Einschlag-Markierung
      if (hits.length > 0) this.applyHit(hits[0], false)
      this.onSwing?.()
      return true
    }

    const muzzlePosition = this.view.getMuzzleWorldPosition(new THREE.Vector3())
    if (hits.length > 0) {
      this.applyHit(hits[0], true)
      this.spawnTracer(muzzlePosition, hits[0].point, this.shooterTeam, this.weaponId)
      this.onShot?.(muzzlePosition, hits[0].point, true)
    } else {
      const missEnd = this.raycaster.ray.origin
        .clone()
        .addScaledVector(this.raycaster.ray.direction, TRACER_MAX_DISTANCE)
      this.spawnTracer(muzzlePosition, missEnd, this.shooterTeam, this.weaponId)
      this.onShot?.(muzzlePosition, missEnd, false)
    }

    if (this.ammo === 0) {
      this.reload()
    }
    return true
  }

  private applyHit(hit: THREE.Intersection, markImpact: boolean) {
    const damageable = hit.object.userData.damageable as Damageable | undefined
    const targetTeam = hit.object.userData.team as Team | undefined

    if (damageable && (targetTeam === this.shooterTeam || damageable.invulnerable)) {
      // Teamkamerad oder Spawn-Schutz: wie ein Wand-Treffer
      if (markImpact) this.spawnImpactMarker(hit)
    } else if (damageable) {
      const headshot = hit.object.userData.headshot === true
      const damage = this.stats.damage * (headshot ? HEADSHOT_MULTIPLIER : 1)
      const wasAlive = damageable.isAlive
      damageable.takeDamage(damage, headshot)
      const killed = wasAlive && !damageable.isAlive
      if (killed) {
        this.onKill?.(this.shooterTeam)
      }
      this.onEnemyHit?.(killed, hit.point, damage, headshot)
    } else if (markImpact) {
      this.spawnImpactMarker(hit)
    }
  }

  reload() {
    if (isMelee(this.weaponId)) return
    if (this.reloadRemaining > 0 || this.switchRemaining > 0 || this.ammo === this.stats.magazine) return
    this.reloadRemaining = this.stats.reloadTime
    this.onReload?.()
  }

  getAmmoState(): AmmoState {
    return {
      weapon: this.weaponId,
      current: this.ammo,
      max: this.stats.magazine,
      reloading: this.reloadRemaining > 0,
      reloadProgress: this.stats.reloadTime > 0 ? 1 - this.reloadRemaining / this.stats.reloadTime : 1,
    }
  }

  // Streuung (rad), die der nächste Schuss hätte - auch fürs Fadenkreuz
  get currentSpread(): number {
    const spread = Math.min(this.stats.maxSpread, Math.max(0, this.heat - PRECISE_SHOTS) * this.stats.spreadPerHeat)
    return spread * (1 - AIM_SPREAD_REDUCTION * this.aimAmount)
  }

  get isMelee(): boolean {
    return isMelee(this.weaponId)
  }

  // Fürs Fadenkreuz: träfe ein Stich jetzt einen Gegner?
  meleeTargetInRange(): boolean {
    if (!this.isMelee) return false
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    this.raycaster.far = this.stats.range
    const hit = this.raycaster.intersectObjects(this.shootables, false).find((h) => h.object.visible)
    const damageable = hit?.object.userData.damageable as Damageable | undefined
    return !!damageable && damageable.isAlive && !damageable.invulnerable && hit!.object.userData.team !== this.shooterTeam
  }

  // Zufällige Abweichung im Kegel, abhängig von der Hitze
  private applySpread() {
    const spread = this.currentSpread
    if (spread <= 0) return
    const quaternion = this.camera.getWorldQuaternion(new THREE.Quaternion())
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * spread
    this.raycaster.ray.direction
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius)
      .normalize()
  }

  private spawnImpactMarker(hit: THREE.Intersection) {
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
    marker.position.copy(hit.point)

    // Minimal entlang der (Welt-)Normale versetzen, gegen Z-Fighting
    if (hit.face) {
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      marker.position.addScaledVector(worldNormal, 0.01)
    }

    this.scene.add(marker)
    this.impactMarkers.push({ mesh: marker, remainingLifetime: IMPACT_MARKER_LIFETIME })
  }

  showRemoteTracer(start: THREE.Vector3, end: THREE.Vector3, team: Team, weapon: WeaponId = 'pistol') {
    this.spawnTracer(start, end, team, weapon)
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3, team: Team, weapon: WeaponId) {
    const style = TRACER_STYLES[weapon]
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length < 0.001) return
    direction.normalize()

    // Additiv und ohne Nebel: der Strahl bleibt auch weit weg sichtbar
    const beamMaterial = (color: THREE.ColorRepresentation, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    const parts: Array<[THREE.CylinderGeometry, THREE.MeshBasicMaterial, number]> = [
      [this.tracerGlowGeometry, beamMaterial(TeamColor[team], style.glow), style.glow],
      [this.tracerCoreGeometry, beamMaterial(0xffffff, 1), 1],
    ]
    const tracer: Tracer = { meshes: [], materials: [], peakOpacity: [], remainingLifetime: style.lifetime, lifetime: style.lifetime }
    for (const [geometry, material, peak] of parts) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.scale.set(style.width, length, style.width)
      mesh.position.copy(start).addScaledVector(direction, length / 2)
      // Zylinder zeigt entlang +Y -> in Schussrichtung drehen
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      this.scene.add(mesh)
      tracer.meshes.push(mesh)
      tracer.materials.push(material)
      tracer.peakOpacity.push(peak)
    }
    this.tracers.push(tracer)
  }
}
