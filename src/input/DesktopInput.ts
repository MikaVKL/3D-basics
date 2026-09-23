import type { Player } from '../player'
import type { LookControl } from '../lookControl'

// Steuerung für Maus + Tastatur (Desktop/Laptop).
// Nutzt die rohe Pointer-Lock-API des Browsers direkt (statt des
// Three.js-Addons), damit Maus-Look genau wie Touch-Look am Ende nur
// `lookControl.rotate(deltaX, deltaY)` aufruft - eine einzige Dreh-Logik
// für beide Eingabearten.

export class DesktopInput {
  private keysPressed = { forward: false, back: false, left: false, right: false }
  private domElement: HTMLElement
  private player: Player
  private lookControl: LookControl
  private onLockChange: (locked: boolean) => void

  constructor(
    domElement: HTMLElement,
    player: Player,
    lookControl: LookControl,
    onLockChange: (locked: boolean) => void
  ) {
    this.domElement = domElement
    this.player = player
    this.lookControl = lookControl
    this.onLockChange = onLockChange

    window.addEventListener('keydown', (e) => this.setKey(e.code, true))
    window.addEventListener('keyup', (e) => this.setKey(e.code, false))

    document.addEventListener('mousemove', (e) => this.handleMouseMove(e))
    document.addEventListener('pointerlockchange', () => {
      this.onLockChange(document.pointerLockElement === this.domElement)
    })
  }

  // Wird vom Klick auf den Startbildschirm aufgerufen (Pointer Lock
  // funktioniert nur nach einer echten Nutzerinteraktion).
  requestActivation() {
    this.domElement.requestPointerLock()
  }

  private handleMouseMove(e: MouseEvent) {
    if (document.pointerLockElement !== this.domElement) return
    this.lookControl.rotate(e.movementX, e.movementY)
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
        this.player.jump()
        break
      default:
        return // bei irrelevanten Tasten gar nicht erst updateMoveInput aufrufen
    }

    this.updateMoveInput()
  }

  private updateMoveInput() {
    const x = Number(this.keysPressed.right) - Number(this.keysPressed.left)
    const z = Number(this.keysPressed.forward) - Number(this.keysPressed.back)
    this.player.setMoveInput(x, z)
  }
}
