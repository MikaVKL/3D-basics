import * as THREE from 'three'
import { EYE_HEIGHT, CROUCH_EYE_HEIGHT } from './player'
import type { PlayerNetworkState } from './shared/protocol'
import { Palette } from './palette'
import { TeamColor, type Team } from './team'
import { DEFAULT_WEAPON, type WeaponId } from './shared/weapons'

// Spieler-Figur im Low-Poly-Stil, gesteuert nur über applyState(). Optik
// und Trefferfläche sind getrennt: "mesh" (Körper-Kapsel) und "headMesh"
// (Kopf-Box) sind unsichtbar, auf sie zielt die Waffe; "root" ist die
// sichtbare Figur. Blickrichtung ist -z (wie die Kamera bei yaw 0).

const HITBOX_RADIUS = 0.35
// Körper bis zum Hals, darüber die Kopf-Box (Oberkante 1.9 wie früher die Kapsel)
const BODY_HEIGHT = 1.45
const HEAD_HITBOX_SIZE = 0.45
const HEAD_CENTER_Y = BODY_HEIGHT + HEAD_HITBOX_SIZE / 2
const CROUCH_DROP = 0.55 // so weit sinkt der Oberkörper im Ducken
const HIT_FLASH_DURATION = 0.08
// Leichtes Eigenleuchten in Teamfarbe: auch im Schatten (von hinten) erkennbar
const TEAM_GLOW = 0.35
// Schwarze Rüstung mit schwachem Farbschimmer: sonst verschwindet sie vor dunklem Hintergrund
const ARMOR_GLOW = 0.22
const STRIDE = 1.1 // Meter pro halbem Beinschwung
const MAX_LEG_SWING = 0.6 // rad
// Rutsch-Pose: Beine nach vorn gestreckt, Oberkörper zurückgelehnt
const SLIDE_POSE_SPEED = 10 // Übergang pro Sekunde
const SLIDE_HIP_HEIGHT = 0.3
const SLIDE_LEG_ANGLE = 1.3 // rad
const SLIDE_LEAN = 0.3 // rad

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
}

// Glied, das an einem Gelenk (pivot) hängt und darum schwingt
function limb(width: number, length: number, depth: number, material: THREE.Material): THREE.Group {
  const pivot = new THREE.Group()
  const part = box(width, length, depth, material)
  part.position.y = -length / 2
  pivot.add(part)
  return pivot
}

export class PlayerAvatar {
  readonly root = new THREE.Group()
  // Unsichtbare Trefferflächen (userData: team, damageable; Kopf: headshot)
  readonly mesh: THREE.Mesh
  readonly headMesh: THREE.Mesh
  private readonly upperBody = new THREE.Group()
  private readonly leftLeg: THREE.Group
  private readonly rightLeg: THREE.Group
  private readonly teamMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 })
  private readonly teamDarkMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 })
  // Leuchtteile in Teamfarbe (Weste, Visier, Waffenkante)
  private readonly armorMaterial = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.45, metalness: 0.3 })
  private readonly neonMaterial = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.6 })
  private readonly materials: THREE.MeshStandardMaterial[]
  private team: Team
  // Gehaltene Waffe, je eine Gruppe (nur die aktive sichtbar)
  private readonly weaponModels: Record<WeaponId, THREE.Group>
  heldWeapon: WeaponId = DEFAULT_WEAPON
  private hitFlashRemaining = 0
  private walkPhase = 0
  private walkSwing = 0
  // 0..1: Ducken folgt der gesendeten Augenhöhe, Rutschen wird geglättet
  private crouchAmount = 0
  private slideAmount = 0
  private slideTarget = 0
  private readonly lastPosition = new THREE.Vector3()
  private hasLastPosition = false

  constructor(team: Team) {
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.8 })
    // Rüstung: fast schwarz, dunkler als Wand und Boden (sonst verschwimmt die Silhouette)
    const armorMaterial = this.armorMaterial
    const gunMaterial = new THREE.MeshStandardMaterial({ color: Palette.weaponBody, roughness: 0.5 })
    this.materials = [this.teamMaterial, this.teamDarkMaterial, headMaterial, gunMaterial, this.neonMaterial, armorMaterial]
    const glow = this.neonMaterial

    const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
    this.mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(HITBOX_RADIUS, BODY_HEIGHT - 2 * HITBOX_RADIUS, 4, 8),
      hitboxMaterial
    )
    this.mesh.position.y = BODY_HEIGHT / 2
    this.root.add(this.mesh)
    this.headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(HEAD_HITBOX_SIZE, HEAD_HITBOX_SIZE, HEAD_HITBOX_SIZE),
      hitboxMaterial
    )
    this.headMesh.position.y = HEAD_CENTER_Y
    this.headMesh.userData.headshot = true
    this.upperBody.add(this.headMesh)

    this.leftLeg = limb(0.22, 0.8, 0.26, this.teamDarkMaterial)
    this.rightLeg = limb(0.22, 0.8, 0.26, this.teamDarkMaterial)
    this.leftLeg.position.set(-0.14, 0.8, 0)
    this.rightLeg.position.set(0.14, 0.8, 0)
    this.root.add(this.leftLeg, this.rightLeg)

    const torso = box(0.6, 0.65, 0.36, this.teamMaterial)
    torso.position.y = 1.125
    const head = box(0.42, 0.42, 0.42, headMaterial)
    head.position.y = 1.67
    const leftArm = limb(0.15, 0.55, 0.17, this.teamMaterial)
    const rightArm = limb(0.15, 0.55, 0.17, this.teamMaterial)
    leftArm.position.set(-0.38, 1.4, 0)
    rightArm.position.set(0.38, 1.4, 0)
    // Waffe rechts: rechte Hand am Griff, linke greift quer an den Lauf
    leftArm.rotation.set(1.25, 0, 0.76)
    rightArm.rotation.set(1.25, 0, -0.37)
    this.upperBody.add(torso, head, leftArm, rightArm)
    const add = (material: THREE.Material, size: [number, number, number], position: [number, number, number], parent: THREE.Object3D = this.upperBody) => {
      const mesh = box(...size, material)
      mesh.position.set(...position)
      parent.add(mesh)
      return mesh
    }
    // Lasertag-Look: dunkle Weste mit Diagonalgurt, Helm mit Visier in Teamfarbe,
    // Leuchtgürtel und Ringe an Armen/Beinen (reine Optik, Trefferflächen bleiben)
    add(armorMaterial, [0.64, 0.5, 0.4], [0, 1.15, 0])
    for (const z of [-0.21, 0.21]) {
      const strap = add(this.neonMaterial, [0.09, 0.5, 0.04], [0, 1.15, z])
      strap.rotation.z = 0.6
    }
    add(this.neonMaterial, [0.62, 0.06, 0.38], [0, 0.88, 0])
    // Schulterkante und Helmrand: Umriss vor dunklem Hintergrund
    add(this.neonMaterial, [0.68, 0.07, 0.44], [0, 1.4, 0])
    for (const x of [-0.33, 0.33]) add(this.neonMaterial, [0.05, 0.5, 0.44], [x, 1.15, 0])
    add(this.neonMaterial, [0.52, 0.06, 0.52], [0, 1.65, 0])
    for (const arm of [leftArm, rightArm]) add(this.neonMaterial, [0.17, 0.05, 0.19], [0, -0.42, 0], arm)
    for (const leg of [this.leftLeg, this.rightLeg]) add(this.neonMaterial, [0.24, 0.05, 0.28], [0, -0.6, 0], leg)
    add(armorMaterial, [0.48, 0.28, 0.48], [0, 1.78, 0])
    add(this.neonMaterial, [0.38, 0.12, 0.04], [0, 1.68, -0.245])
    add(this.neonMaterial, [0.03, 0.22, 0.03], [0.15, 2.05, 0.15])
    this.root.add(this.upperBody)

    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.35, metalness: 0.2 })
    this.materials.push(bladeMaterial)
    const model = (parts: [THREE.Material, [number, number, number], [number, number, number]][]) => {
      const group = new THREE.Group()
      for (const [material, size, position] of parts) {
        const mesh = box(...size, material)
        mesh.position.set(...position)
        group.add(mesh)
      }
      this.upperBody.add(group)
      return group
    }
    this.weaponModels = {
      pistol: model([
        [gunMaterial, [0.09, 0.13, 0.3], [0.18, 1.3, -0.55]],
        [glow, [0.1, 0.03, 0.12], [0.18, 1.37, -0.52]],
      ]),
      rifle: model([
        [gunMaterial, [0.1, 0.14, 0.75], [0.18, 1.28, -0.55]],
        [gunMaterial, [0.07, 0.18, 0.09], [0.18, 1.15, -0.62]],
        [glow, [0.11, 0.03, 0.5], [0.18, 1.36, -0.6]],
      ]),
      shotgun: model([
        [gunMaterial, [0.1, 0.12, 0.85], [0.18, 1.29, -0.6]],
        [gunMaterial, [0.07, 0.07, 0.4], [0.18, 1.2, -0.7]],
        [glow, [0.11, 0.03, 0.4], [0.18, 1.37, -0.65]],
      ]),
      sniper: model([
        [gunMaterial, [0.09, 0.12, 0.95], [0.18, 1.29, -0.65]],
        [gunMaterial, [0.06, 0.06, 0.3], [0.18, 1.4, -0.55]],
        [glow, [0.1, 0.03, 0.4], [0.18, 1.35, -0.75]],
      ]),
      heavyPistol: model([
        [gunMaterial, [0.1, 0.14, 0.36], [0.18, 1.3, -0.57]],
        [glow, [0.11, 0.03, 0.14], [0.18, 1.38, -0.54]],
      ]),
      knife: model([
        [gunMaterial, [0.06, 0.07, 0.14], [0.18, 1.28, -0.48]],
        [bladeMaterial, [0.03, 0.09, 0.3], [0.18, 1.28, -0.7]],
      ]),
    }
    this.setWeapon(DEFAULT_WEAPON)

    this.team = team
    this.setTeam(team)
  }

  setTeam(team: Team) {
    this.team = team
    this.teamMaterial.color.set(TeamColor[team])
    this.teamDarkMaterial.color.set(TeamColor[team]).multiplyScalar(0.55)
    this.neonMaterial.color.set(TeamColor[team]).lerp(new THREE.Color(0xffffff), 0.35)
    this.neonMaterial.emissive.set(TeamColor[team])
    this.armorMaterial.emissive.set(TeamColor[team]).multiplyScalar(ARMOR_GLOW)
    this.resetGlow()
    // weapon.ts liest das Team am Mesh (Friendly-Fire)
    this.mesh.userData.team = team
    this.headMesh.userData.team = team
  }

  setWeapon(weapon: WeaponId) {
    this.heldWeapon = weapon
    for (const [id, group] of Object.entries(this.weaponModels)) group.visible = id === weapon
  }

  // Körpermitte in Weltkoordinaten (z.B. Richtung für den Schadensanzeiger)
  get centerPosition(): THREE.Vector3 {
    return this.mesh.getWorldPosition(new THREE.Vector3())
  }

  // Nur Yaw - sonst kippt die Figur beim Hoch-/Runterschauen
  applyState(state: PlayerNetworkState) {
    if (this.team !== state.team) this.setTeam(state.team)
    if (this.heldWeapon !== state.weapon) this.setWeapon(state.weapon)

    // Tatsächliche Augenhöhe statt Duck-Flag: beim Ducken sinkt die Kamera
    // über ~0,1 s ab - mit dem Flag hüpfte die Figur dabei 0,7 m hoch
    this.root.position.set(state.position.x, state.position.y - state.eyeHeight, state.position.z)
    this.root.rotation.set(0, state.yaw, 0)
    this.crouchAmount = THREE.MathUtils.clamp((EYE_HEIGHT - state.eyeHeight) / (EYE_HEIGHT - CROUCH_EYE_HEIGHT), 0, 1)
    this.slideTarget = state.sliding ? 1 : 0

    const height = BODY_HEIGHT - CROUCH_DROP * this.crouchAmount
    this.mesh.scale.y = height / BODY_HEIGHT
    this.mesh.position.y = height / 2

    this.animateWalk()
    this.applyPose()

    this.root.visible = state.isAlive
    // Raycaster prüft "visible" am getroffenen Objekt selbst, nicht am Elternteil
    this.mesh.visible = state.isAlive
    this.headMesh.visible = state.isAlive
  }

  // Stehen/Ducken/Rutschen stufenlos gemischt
  private applyPose() {
    const crouch = this.crouchAmount
    const slide = this.slideAmount
    this.upperBody.position.y = -CROUCH_DROP * Math.max(crouch, slide)
    this.upperBody.rotation.x = SLIDE_LEAN * slide
    const crouchLegScale = 1 - 0.65 * crouch
    const legScale = THREE.MathUtils.lerp(crouchLegScale, 1, slide)
    const hipHeight = THREE.MathUtils.lerp(0.8 * crouchLegScale, SLIDE_HIP_HEIGHT, slide)
    const swing = this.walkSwing * (1 - 0.5 * crouch)
    for (const [leg, side] of [[this.leftLeg, 1], [this.rightLeg, -1]] as const) {
      leg.scale.y = legScale
      leg.position.y = hipHeight
      leg.rotation.x = THREE.MathUtils.lerp(swing * side, SLIDE_LEG_ANGLE - 0.1 * side, slide)
    }
    this.root.updateMatrixWorld()
  }

  // Beine schwingen passend zur zurückgelegten Strecke am Boden
  private animateWalk() {
    const position = this.root.position
    const moved = this.hasLastPosition
      ? Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z)
      : 0
    this.lastPosition.copy(position)
    this.hasLastPosition = true
    if (moved > 2) return // Teleport/Respawn
    this.walkPhase += (moved / STRIDE) * Math.PI
    // Stillstand: Beine laufen langsam zurück in die Ruheposition
    this.walkSwing = moved > 0.002 ? Math.sin(this.walkPhase) * MAX_LEG_SWING : this.walkSwing * 0.8
  }

  // Spawn-Schutz: halb durchsichtig
  setProtected(isProtected: boolean) {
    for (const material of this.materials) {
      material.transparent = isProtected
      material.opacity = isProtected ? 0.4 : 1
    }
  }

  flash() {
    this.hitFlashRemaining = HIT_FLASH_DURATION
    this.teamMaterial.emissive.set(0xffffff)
    this.teamDarkMaterial.emissive.set(0xffffff)
  }

  update(deltaSeconds: number) {
    if (this.slideAmount !== this.slideTarget) {
      const step = SLIDE_POSE_SPEED * deltaSeconds
      this.slideAmount += THREE.MathUtils.clamp(this.slideTarget - this.slideAmount, -step, step)
      this.applyPose()
    }
    if (this.hitFlashRemaining <= 0) return
    this.hitFlashRemaining -= deltaSeconds
    if (this.hitFlashRemaining <= 0) this.resetGlow()
  }

  private resetGlow() {
    this.teamMaterial.emissive.set(TeamColor[this.team]).multiplyScalar(TEAM_GLOW)
    this.teamDarkMaterial.emissive.set(TeamColor[this.team]).multiplyScalar(TEAM_GLOW * 0.55)
  }

  dispose() {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
    for (const material of this.materials) material.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
