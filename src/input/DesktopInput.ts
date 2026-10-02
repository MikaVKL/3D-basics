import type { Player } from '../player'
import type { LookControl } from '../lookControl'
import type { Weapon } from '../weapon'

// Maus + Tastatur über die rohe Pointer-Lock-API; Umschauen läuft wie bei
// Touch über lookControl.rotate()

export class DesktopInput {
  private keysPressed = { forward: false, back: false, left: false, right: false }
  private domElement: HTMLElement
  private player: Player
  private lookControl: LookControl
  private weapon: Weapon
  private onLockChange: (locked: boolean) => void

  constructor(
    domElement: HTMLElement,
    player: Player,
    lookControl: LookControl,
    weapon: Weapon,
    onLockChange: (locked: boolean) => void
  ) {
    this.domElement = domElement
    this.player = player
    this.lookControl = lookControl
    this.weapon = weapon
    this.onLockChange = onLockChange

    window.addEventListener('keydown', (e) => {
      // Tippen im Namensfeld soll nicht steuern
      if (e.target instanceof HTMLInputElement) return
      this.setKey(e.code, true)
    })
    window.addEventListener('keyup', (e) => this.setKey(e.code, false))

    document.addEventListener('mousemove', (e) => this.handleMouseMove(e))
    document.addEventListener('mousedown', (e) => this.handleMouseDown(e))
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.weapon.setTrigger(false)
      if (e.button === 2) this.weapon.setAiming(false)
    })
    // Rechte Maustaste zielt: kein Kontextmenü im Spiel
    document.addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement === this.domElement) e.preventDefault()
    })
    document.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.domElement || e.deltaY === 0) return
      this.weapon.cycle(e.deltaY > 0 ? 1 : -1)
    })
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.domElement
      if (!locked) this.weapon.cancelFire()
      this.onLockChange(locked)
    })
  }

  // Pointer Lock geht nur nach echter Nutzerinteraktion (Klick)
  requestActivation() {
    this.domElement.requestPointerLock()
  }

  private handleMouseMove(e: MouseEvent) {
    if (document.pointerLockElement !== this.domElement) return
    this.lookControl.rotate(e.movementX, e.movementY)
  }

  private handleMouseDown(e: MouseEvent) {
    if (document.pointerLockElement !== this.domElement) return
    if (!this.player.isAlive) return
    if (e.button === 2) this.weapon.setAiming(true)
    if (e.button !== 0) return
    this.weapon.setTrigger(true)
  }

  private setKey(code: string, pressed: boolean) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keysPressed.forward = pressed
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keysPressed.back = pressed
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keysPressed.left = pressed
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keysPressed.right = pressed
        break
      case 'Space':
        // Nur beim Drücken (sonst zweiter Sprung beim Loslassen)
        if (pressed) this.player.jump()
        break
      case 'KeyR':
        if (pressed) this.weapon.reload()
        break
      case 'Digit1':
      case 'Digit2':
      case 'Digit3': {
        const slot = this.weapon.slots[Number(code.slice(5)) - 1]
        if (pressed && slot) this.weapon.switchTo(slot)
        break
      }
      case 'KeyQ':
        if (pressed) this.weapon.switchToPrevious()
        break
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        this.player.setCrouching(pressed)
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        this.player.setSprinting(pressed)
        break
      default:
        return
    }

    this.updateMoveInput()
  }

  private updateMoveInput() {
    const x = Number(this.keysPressed.right) - Number(this.keysPressed.left)
    const z = Number(this.keysPressed.forward) - Number(this.keysPressed.back)
    this.player.setMoveInput(x, z)
  }
}
