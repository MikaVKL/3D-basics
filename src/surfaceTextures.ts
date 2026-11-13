import * as THREE from 'three'

// Dezente Oberflächenmuster als Graustufen (per Canvas, keine Bilddateien).
// Sie werden mit der Materialfarbe multipliziert - die Palette bleibt gleich,
// es kommen nur Fugen/Rahmen dazu. Eine Textur = ein Feld; worldBox legt je
// Seite eine ganze Zahl Felder passender Größe (kein angeschnittener Rahmen).

const SIZE = 128

export const CRATE_TILE = 1.4 // m
export const PANEL_TILE = 3 // m

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void, size = SIZE): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 2
  return texture
}

const gray = (value: number) => `rgb(${value}, ${value}, ${value})`

// Kiste: Rahmen und zwei Bretterfugen je Feld
export function createCrateTexture(): THREE.Texture {
  return canvasTexture((g) => {
    g.fillStyle = gray(255)
    g.fillRect(0, 0, SIZE, SIZE)
    g.fillStyle = gray(200)
    for (const y of [SIZE / 3, (2 * SIZE) / 3]) g.fillRect(0, y - 1, SIZE, 2)
    g.strokeStyle = gray(165)
    g.lineWidth = 8
    g.strokeRect(4, 4, SIZE - 8, SIZE - 8)
  })
}

// Wand/Plattform: große Platten mit schmaler Fuge
export function createPanelTexture(): THREE.Texture {
  return canvasTexture((g) => {
    g.fillStyle = gray(255)
    g.fillRect(0, 0, SIZE, SIZE)
    g.strokeStyle = gray(185)
    g.lineWidth = 3
    g.strokeRect(1.5, 1.5, SIZE - 3, SIZE - 3)
  })
}

// Quader, dessen Muster nicht mit der Größe verzerrt: je Seite so viele
// ganze Felder, wie etwa hineinpassen (Feldgröße ~tile Meter)
export function worldBox(width: number, height: number, depth: number, tile = PANEL_TILE): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  // Reihenfolge der BoxGeometry-Seiten: +x, -x, +y, -y, +z, -z (je 4 Ecken)
  const faceSizes: [number, number][] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ]
  for (let face = 0; face < 6; face++) {
    const [u, v] = faceSizes[face].map((size) => Math.max(1, Math.round(size / tile)))
    for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
  }
  uv.needsUpdate = true
  return geometry
}

// --- Tageslicht-Satz für die Testkarte Skyline (reicher als der Standard; Nexus nutzt ihn nicht) ---
// Alles Graustufen, die Materialfarbe färbt ein. Feste Zufallsfolge: jeder Start sieht gleich aus.

const SKY_SIZE = 256

function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Körnung: viele winzige Punkte um den Grundton
function speckle(g: CanvasRenderingContext2D, random: () => number, count: number, spread: number, base: number, size = 2) {
  for (let i = 0; i < count; i++) {
    const v = Math.round(base + (random() - 0.5) * spread)
    g.fillStyle = gray(Math.max(0, Math.min(255, v)))
    g.fillRect(random() * SKY_SIZE, random() * SKY_SIZE, size, size)
  }
}

// Beton: Körnung, Plattenfugen, Schrauben in den Ecken, schwache senkrechte Schlieren
export function createConcreteTexture(clean = false): THREE.Texture {
  return canvasTexture((g) => {
    const random = seeded(11)
    g.fillStyle = gray(clean ? 248 : 236)
    g.fillRect(0, 0, SKY_SIZE, SKY_SIZE)
    if (clean) {
      // lackierte Paneele: kaum Körnung, helle Fuge mit Schattenkante, keine Schrauben/Schlieren
      speckle(g, random, 1200, 8, 246)
      g.strokeStyle = gray(212)
      g.lineWidth = 6
      g.strokeRect(3, 3, SKY_SIZE - 6, SKY_SIZE - 6)
      g.strokeStyle = gray(236)
      g.lineWidth = 2
      g.strokeRect(8, 8, SKY_SIZE - 16, SKY_SIZE - 16)
      return
    }
    speckle(g, random, 5000, 34, 232)
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(90, 100, 110, ${0.03 + random() * 0.05})`
      g.fillRect(random() * SKY_SIZE, 0, 2 + random() * 5, SKY_SIZE * (0.4 + random() * 0.6))
    }
    g.strokeStyle = gray(150)
    g.lineWidth = 4
    g.strokeRect(2, 2, SKY_SIZE - 4, SKY_SIZE - 4)
    g.fillStyle = gray(120)
    for (const [x, y] of [[14, 14], [SKY_SIZE - 14, 14], [14, SKY_SIZE - 14], [SKY_SIZE - 14, SKY_SIZE - 14]]) {
      g.beginPath()
      g.arc(x, y, 3.5, 0, Math.PI * 2)
      g.fill()
    }
  }, SKY_SIZE)
}

// Boden: vier Fliesen je Feld mit leicht verschiedenem Ton, Fugen, Abrieb
export function createFloorTexture(clean = false): THREE.Texture {
  return canvasTexture((g) => {
    const random = seeded(23)
    const half = SKY_SIZE / 2
    if (clean) {
      // große, ruhige Fliesen: zwei Töne im Schachbrett, feine helle Fuge
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          g.fillStyle = gray((tx + ty) % 2 === 0 ? 250 : 232)
          g.fillRect(tx * half, ty * half, half, half)
        }
      }
      speckle(g, random, 900, 6, 240)
      g.strokeStyle = gray(205)
      g.lineWidth = 2
      g.strokeRect(1, 1, SKY_SIZE - 2, SKY_SIZE - 2)
      return
    }
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        g.fillStyle = gray(Math.round(212 + random() * 30))
        g.fillRect(tx * half, ty * half, half, half)
      }
    }
    speckle(g, random, 4500, 26, 222)
    g.strokeStyle = gray(165)
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(half, 0)
    g.lineTo(half, SKY_SIZE)
    g.moveTo(0, half)
    g.lineTo(SKY_SIZE, half)
    g.stroke()
    g.lineWidth = 5
    g.strokeStyle = gray(150)
    g.strokeRect(3, 3, SKY_SIZE - 6, SKY_SIZE - 6)
  }, SKY_SIZE)
}

// Holzkiste: vier Bretter mit Maserung, Rahmen, Diagonalstrebe, Nägel
export function createWoodTexture(): THREE.Texture {
  return canvasTexture((g) => {
    const random = seeded(37)
    const board = SKY_SIZE / 4
    for (let i = 0; i < 4; i++) {
      g.fillStyle = gray(Math.round(225 + random() * 28))
      g.fillRect(0, i * board, SKY_SIZE, board)
      for (let k = 0; k < 7; k++) {
        const y = i * board + 6 + random() * (board - 12)
        g.strokeStyle = gray(Math.round(150 + random() * 40))
        g.lineWidth = 1 + random() * 1.5
        g.beginPath()
        g.moveTo(0, y)
        g.bezierCurveTo(SKY_SIZE * 0.3, y + (random() - 0.5) * 6, SKY_SIZE * 0.65, y + (random() - 0.5) * 6, SKY_SIZE, y + (random() - 0.5) * 4)
        g.stroke()
      }
      g.fillStyle = gray(120)
      g.fillRect(0, i * board, SKY_SIZE, 3)
    }
    g.strokeStyle = gray(150)
    g.lineWidth = 16
    g.strokeRect(8, 8, SKY_SIZE - 16, SKY_SIZE - 16)
    g.lineWidth = 12
    g.beginPath()
    g.moveTo(16, 16)
    g.lineTo(SKY_SIZE - 16, SKY_SIZE - 16)
    g.stroke()
    g.fillStyle = gray(70)
    for (const [x, y] of [[16, 16], [SKY_SIZE - 16, 16], [16, SKY_SIZE - 16], [SKY_SIZE - 16, SKY_SIZE - 16]]) g.fillRect(x - 3, y - 3, 6, 6)
  }, SKY_SIZE)
}

// Metall (Reling, Masten, Kran): feine Bürstenstreifen quer, Kantenrahmen
export function createMetalTexture(): THREE.Texture {
  return canvasTexture((g) => {
    const random = seeded(51)
    g.fillStyle = gray(232)
    g.fillRect(0, 0, SKY_SIZE, SKY_SIZE)
    for (let y = 0; y < SKY_SIZE; y += 2) {
      g.fillStyle = gray(Math.round(205 + random() * 45))
      g.fillRect(0, y, SKY_SIZE, 2)
    }
    g.strokeStyle = gray(150)
    g.lineWidth = 6
    g.strokeRect(3, 3, SKY_SIZE - 6, SKY_SIZE - 6)
  }, SKY_SIZE)
}

// Container: senkrechtes Wellblech
export function createCorrugatedTexture(): THREE.Texture {
  return canvasTexture((g) => {
    const rib = SKY_SIZE / 16
    for (let i = 0; i < 16; i++) {
      const grad = g.createLinearGradient(i * rib, 0, (i + 1) * rib, 0)
      grad.addColorStop(0, gray(250))
      grad.addColorStop(0.5, gray(196))
      grad.addColorStop(1, gray(250))
      g.fillStyle = grad
      g.fillRect(i * rib, 0, rib, SKY_SIZE)
    }
    g.strokeStyle = gray(130)
    g.lineWidth = 8
    g.strokeRect(4, 4, SKY_SIZE - 8, SKY_SIZE - 8)
  }, SKY_SIZE)
}

// Waagerechte Deckfläche (Boden-Auflage ohne Kollision): Fliesen im Takt `tile` Meter
export function floorOverlay(width: number, depth: number, tile = PANEL_TILE): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, depth)
  geometry.rotateX(-Math.PI / 2)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const u = Math.max(1, Math.round(width / tile))
  const v = Math.max(1, Math.round(depth / tile))
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
  uv.needsUpdate = true
  return geometry
}
