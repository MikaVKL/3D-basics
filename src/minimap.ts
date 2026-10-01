import type { Ramp, Solid } from './arena'
import { Palette } from './palette'
import { TeamColor, type Team } from './team'

// Minimap (Norden oben): entsteht aus denselben Daten wie die Kollision
// (arena.solids + arena.ramps). Neue Kisten, Wände, Stege oder Hallen
// erscheinen von selbst, der Ausschnitt passt sich der Arena an. Nur Teamkameraden
// werden gezeigt, keine Gegner (sonst wäre es ein Radar durch Wände).

const MARGIN = 1.5 // Meter Rand um die Arena
const UPPER_FROM = 2 // ab dieser Höhe: obere Ebene (Stege, Brücken, Geländer)
const MIN_FOOTPRINT = 0.5 // kleinere Teile (Stützen unter Stegen) bleiben weg
const DOT_RADIUS = 3.2
const ARROW_SIZE = 7

export interface MinimapSelf {
  x: number
  z: number
  dirX: number // Blickrichtung waagerecht (Welt), muss nicht normiert sein
  dirZ: number
  high: boolean // steht auf der oberen Ebene
  team: Team
}

export interface MinimapMate {
  x: number
  z: number
  high: boolean
}

export interface MinimapBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

const COLORS = {
  wall: '#566b82',
  cover: hex(Palette.crate),
  raised: '#2c8f86',
  upper: 'rgba(51, 230, 204, 0.55)',
  rampLow: 'rgba(51, 230, 204, 0.15)',
  rampHigh: 'rgba(51, 230, 204, 0.8)',
}

export class Minimap {
  bounds: MinimapBounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }

  private readonly root: HTMLElement
  private readonly solids: readonly Solid[]
  private readonly ramps: readonly Ramp[]
  private readonly staticCanvas = document.createElement('canvas')
  private readonly liveCanvas = document.createElement('canvas')
  private readonly floorLabel = document.createElement('span')
  private scale = 1 // Pixel pro Meter (Zeichenfläche)
  private ratio = 1 // Pixel pro CSS-Pixel

  constructor(root: HTMLElement, solids: readonly Solid[], ramps: readonly Ramp[]) {
    this.root = root
    this.solids = solids
    this.ramps = ramps
    this.staticCanvas.className = 'minimap-static'
    this.liveCanvas.className = 'minimap-live'
    this.floorLabel.className = 'minimap-floor'
    root.append(this.staticCanvas, this.liveCanvas, this.floorLabel)
    this.rebuild()
    window.addEventListener('resize', () => this.resize())
  }

  // Grenzen aus allen Objekten neu bestimmen und die Karte neu zeichnen
  // (nach Änderungen an der Arena, und beim Start)
  rebuild() {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const { box } of this.solids) {
      minX = Math.min(minX, box.min.x)
      maxX = Math.max(maxX, box.max.x)
      minZ = Math.min(minZ, box.min.z)
      maxZ = Math.max(maxZ, box.max.z)
    }
    if (!Number.isFinite(minX)) return
    this.bounds = { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN }
    this.root.style.aspectRatio = `${this.bounds.maxX - this.bounds.minX} / ${this.bounds.maxZ - this.bounds.minZ}`
    this.resize()
  }

  // Weltposition -> Pixel in CSS-Pixeln innerhalb der Karte
  toPixel(x: number, z: number): [number, number] {
    const factor = this.scale / this.ratio
    return [(x - this.bounds.minX) * factor, (z - this.bounds.minZ) * factor]
  }

  private resize() {
    const width = this.root.clientWidth
    if (width === 0) return
    this.ratio = Math.min(2, window.devicePixelRatio || 1)
    const pixelWidth = Math.round(width * this.ratio)
    const pixelHeight = Math.round((pixelWidth * (this.bounds.maxZ - this.bounds.minZ)) / (this.bounds.maxX - this.bounds.minX))
    for (const canvas of [this.staticCanvas, this.liveCanvas]) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    this.scale = pixelWidth / (this.bounds.maxX - this.bounds.minX)
    this.drawStatic()
    // Das HUD (Kill-Feed) richtet sich nach der Höhe der Karte
    document.documentElement.style.setProperty('--minimap-h', `${this.root.offsetHeight}px`)
  }

  private drawStatic() {
    const context = this.staticCanvas.getContext('2d')!
    context.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height)
    const rect = (box: Solid['box']) => {
      const [x, z] = [(box.min.x - this.bounds.minX) * this.scale, (box.min.z - this.bounds.minZ) * this.scale]
      context.fillRect(x, z, (box.max.x - box.min.x) * this.scale, (box.max.z - box.min.z) * this.scale)
    }
    const footprintBigEnough = (box: Solid['box']) => box.max.x - box.min.x >= MIN_FOOTPRINT || box.max.z - box.min.z >= MIN_FOOTPRINT
    const isUpper = (solid: Solid) => solid.kind === undefined && solid.box.min.y >= UPPER_FROM
    const layers: Array<[string, (solid: Solid) => boolean]> = [
      [COLORS.wall, (s) => s.kind === 'wall'],
      [COLORS.cover, (s) => s.kind === 'cover'],
      [COLORS.raised, (s) => s.kind === undefined && !isUpper(s) && footprintBigEnough(s.box) && s.box.max.y >= UPPER_FROM],
    ]
    for (const [color, match] of layers) {
      context.fillStyle = color
      for (const solid of this.solids) if (match(solid)) rect(solid.box)
    }
    this.drawRamps(context)
    // Obere Ebene zuletzt und durchscheinend: man sieht, was darunter liegt
    context.fillStyle = COLORS.upper
    for (const solid of this.solids) if (isUpper(solid)) rect(solid.box)
  }

  // Helligkeit steigt in Richtung der höheren Seite
  private drawRamps(context: CanvasRenderingContext2D) {
    for (const ramp of this.ramps) {
      const x = (ramp.minX - this.bounds.minX) * this.scale
      const z = (ramp.minZ - this.bounds.minZ) * this.scale
      const width = (ramp.maxX - ramp.minX) * this.scale
      const depth = (ramp.maxZ - ramp.minZ) * this.scale
      const alongX = ramp.axis === 'x'
      const gradient = context.createLinearGradient(x, z, alongX ? x + width : x, alongX ? z : z + depth)
      gradient.addColorStop(0, ramp.ascending ? COLORS.rampLow : COLORS.rampHigh)
      gradient.addColorStop(1, ramp.ascending ? COLORS.rampHigh : COLORS.rampLow)
      context.fillStyle = gradient
      context.fillRect(x, z, width, depth)
    }
  }

  // Pro Bild: du (Pfeil) und dein Team (Punkte); andere Etage gedimmt
  update(self: MinimapSelf, mates: readonly MinimapMate[]) {
    const context = this.liveCanvas.getContext('2d')!
    context.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height)
    const toCanvas = (x: number, z: number): [number, number] => [(x - this.bounds.minX) * this.scale, (z - this.bounds.minZ) * this.scale]
    const color = hex(TeamColor[self.team])

    context.fillStyle = color
    for (const mate of mates) {
      const [x, z] = toCanvas(mate.x, mate.z)
      context.globalAlpha = mate.high === self.high ? 1 : 0.35
      context.beginPath()
      context.arc(x, z, DOT_RADIUS * this.ratio, 0, Math.PI * 2)
      context.fill()
    }
    context.globalAlpha = 1

    const [x, z] = toCanvas(self.x, self.z)
    const size = ARROW_SIZE * this.ratio
    context.save()
    context.translate(x, z)
    context.rotate(Math.atan2(self.dirZ, self.dirX))
    context.beginPath()
    context.moveTo(size, 0)
    context.lineTo(-size * 0.7, size * 0.7)
    context.lineTo(-size * 0.3, 0)
    context.lineTo(-size * 0.7, -size * 0.7)
    context.closePath()
    context.fillStyle = '#ffffff'
    context.strokeStyle = color
    context.lineWidth = 1.5 * this.ratio
    context.fill()
    context.stroke()
    context.restore()

    const floor = self.high ? 'OBEN' : 'UNTEN'
    if (this.floorLabel.textContent !== floor) {
      this.floorLabel.textContent = floor
      this.floorLabel.dataset.floor = self.high ? 'high' : 'low'
    }
  }
}
