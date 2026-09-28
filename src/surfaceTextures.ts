import * as THREE from 'three'

// Dezente Oberflächenmuster als Graustufen (per Canvas, keine Bilddateien).
// Sie werden mit der Materialfarbe multipliziert - die Palette bleibt gleich,
// es kommen nur Fugen/Rahmen dazu. Eine Textur = ein Feld; worldBox legt je
// Seite eine ganze Zahl Felder passender Größe (kein angeschnittener Rahmen).

const SIZE = 128

export const CRATE_TILE = 1.4 // m
export const PANEL_TILE = 3 // m

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
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
