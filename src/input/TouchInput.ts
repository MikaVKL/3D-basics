import type { Player } from '../player'
import type { LookControl } from '../lookControl'
import type { Weapon } from '../weapon'

// Touch-Steuerung fürs Tablet/Handy (z.B. iPad ohne Maus/Tastatur):
// - Linke Bildschirmhälfte: virtueller Joystick zum Bewegen (erscheint dort,
//   wo man hintippt - "floating joystick", wie in den meisten Mobile-Shootern)
// - Rechte Bildschirmhälfte: Wisch-Geste zum Umschauen (wie ein Kamera-Drag)
// - Extra Button: Springen
//
// Beide Zonen tracken ihren eigenen Finger über die Touch-ID, damit man
// gleichzeitig laufen UND umschauen kann (Multi-Touch).

const JOYSTICK_RADIUS = 45 // maximaler Ausschlag des Joystick-Daumens in Pixel

interface TouchElements {
  moveZone: HTMLElement
  lookZone: HTMLElement
  joystickBase: HTMLElement
  joystickThumb: HTMLElement
  jumpButton: HTMLElement
  shootButton: HTMLElement
  reloadButton: HTMLElement
}

export class TouchInput {
  private moveTouchId: number | null = null
  private moveOrigin = { x: 0, y: 0 }

  private lookTouchId: number | null = null
  private lastLookPos = { x: 0, y: 0 }

  private elements: TouchElements
  private player: Player
  private lookControl: LookControl
  private weapon: Weapon

  constructor(elements: TouchElements, player: Player, lookControl: LookControl, weapon: Weapon) {
    this.elements = elements
    this.player = player
    this.lookControl = lookControl
    this.weapon = weapon

    const { moveZone, lookZone, jumpButton, shootButton, reloadButton } = elements

    moveZone.addEventListener('touchstart', (e) => this.onMoveStart(e), { passive: false })
    moveZone.addEventListener('touchmove', (e) => this.onMoveMove(e), { passive: false })
    moveZone.addEventListener('touchend', (e) => this.onMoveEnd(e))
    moveZone.addEventListener('touchcancel', (e) => this.onMoveEnd(e))

    lookZone.addEventListener('touchstart', (e) => this.onLookStart(e), { passive: false })
    lookZone.addEventListener('touchmove', (e) => this.onLookMove(e), { passive: false })
    lookZone.addEventListener('touchend', (e) => this.onLookEnd(e))
    lookZone.addEventListener('touchcancel', (e) => this.onLookEnd(e))

    jumpButton.addEventListener('touchstart', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.player.jump()
    })

    shootButton.addEventListener('touchstart', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!this.player.isAlive) return
      this.weapon.tryShoot()
    })

    reloadButton.addEventListener('touchstart', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.weapon.reload()
    })
  }

  private onMoveStart(e: TouchEvent) {
    e.preventDefault()
    if (this.moveTouchId !== null) return // schon ein Finger aktiv

    const touch = e.changedTouches[0]
    this.moveTouchId = touch.identifier
    this.moveOrigin = { x: touch.clientX, y: touch.clientY }

    const { joystickBase, joystickThumb } = this.elements
    joystickBase.style.left = `${touch.clientX}px`
    joystickBase.style.top = `${touch.clientY}px`
    joystickBase.classList.add('active')
    joystickThumb.style.transform = 'translate(-50%, -50%)'
  }

  private onMoveMove(e: TouchEvent) {
    const touch = this.findTouch(e.touches, this.moveTouchId)
    if (!touch) return
    e.preventDefault()

    let dx = touch.clientX - this.moveOrigin.x
    let dy = touch.clientY - this.moveOrigin.y
    const distance = Math.hypot(dx, dy)

    if (distance > JOYSTICK_RADIUS) {
      dx = (dx / distance) * JOYSTICK_RADIUS
      dy = (dy / distance) * JOYSTICK_RADIUS
    }

    this.elements.joystickThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`

    // Nach oben ziehen = vorwärts, daher das Minus bei y.
    this.player.setMoveInput(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS)
  }

  private onMoveEnd(e: TouchEvent) {
    if (!this.findTouch(e.changedTouches, this.moveTouchId)) return

    this.moveTouchId = null
    this.player.setMoveInput(0, 0)
    this.elements.joystickBase.classList.remove('active')
  }

  private onLookStart(e: TouchEvent) {
    e.preventDefault()
    if (this.lookTouchId !== null) return

    const touch = e.changedTouches[0]
    this.lookTouchId = touch.identifier
    this.lastLookPos = { x: touch.clientX, y: touch.clientY }
  }

  private onLookMove(e: TouchEvent) {
    const touch = this.findTouch(e.touches, this.lookTouchId)
    if (!touch) return
    e.preventDefault()

    const deltaX = touch.clientX - this.lastLookPos.x
    const deltaY = touch.clientY - this.lastLookPos.y
    this.lastLookPos = { x: touch.clientX, y: touch.clientY }

    this.lookControl.rotate(deltaX, deltaY)
  }

  private onLookEnd(e: TouchEvent) {
    if (!this.findTouch(e.changedTouches, this.lookTouchId)) return
    this.lookTouchId = null
  }

  private findTouch(touchList: TouchList, id: number | null): Touch | null {
    if (id === null) return null
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === id) return touchList[i]
    }
    return null
  }
}
