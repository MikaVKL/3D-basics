// Alle Sounds werden per Web Audio synthetisiert (keine Audiodateien).
// Jede Synth-Funktion spielt auf ein beliebiges Ziel - live oder in einem
// OfflineAudioContext (Tests prüfen so, dass jeder Sound hörbar ist).

import * as THREE from 'three'

type Synth = (ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer) => void

const MUTE_STORAGE_KEY = 'duskArena.muted'

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  type: OscillatorType,
  fromHz: number,
  toHz: number,
  peak: number,
  duration: number,
  delay = 0
) {
  const osc = ctx.createOscillator()
  osc.type = type
  const t = ctx.currentTime + delay
  osc.frequency.setValueAtTime(fromHz, t)
  osc.frequency.exponentialRampToValueAtTime(toHz, t + duration)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  filter: BiquadFilterType,
  frequency: number,
  peak: number,
  duration: number,
  delay = 0
) {
  const source = ctx.createBufferSource()
  source.buffer = noise
  const biquad = ctx.createBiquadFilter()
  biquad.type = filter
  biquad.frequency.value = frequency
  const t = ctx.currentTime + delay
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  source.connect(biquad).connect(gain).connect(out)
  source.start(t)
  source.stop(t + duration + 0.02)
}

export const SYNTHS = {
  // Laserpistole: fallender Sägezahn + kurzes Rauschen
  shot: (ctx, out, noise) => {
    tone(ctx, out, 'sawtooth', 1400, 180, 0.35, 0.14)
    noiseBurst(ctx, out, noise, 'highpass', 2500, 0.2, 0.05)
  },
  reload: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 3000, 0.4, 0.04)
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.4, 0.05, 0.45)
    tone(ctx, out, 'square', 500, 900, 0.12, 0.08, 1.05)
  },
  hit: (ctx, out) => tone(ctx, out, 'sine', 1900, 1700, 0.3, 0.06),
  // Heller Doppel-"Ping", klar vom normalen Treffer unterscheidbar
  headshot: (ctx, out) => {
    tone(ctx, out, 'sine', 2600, 2500, 0.3, 0.05)
    tone(ctx, out, 'triangle', 3400, 3300, 0.25, 0.09, 0.045)
  },
  kill: (ctx, out) => {
    tone(ctx, out, 'triangle', 880, 880, 0.35, 0.12)
    tone(ctx, out, 'triangle', 1320, 1320, 0.35, 0.22, 0.09)
  },
  hurt: (ctx, out, noise) => {
    tone(ctx, out, 'sine', 160, 60, 0.6, 0.18)
    noiseBurst(ctx, out, noise, 'lowpass', 900, 0.3, 0.12)
  },
  jump: (ctx, out) => tone(ctx, out, 'sine', 220, 440, 0.12, 0.1),
  land: (ctx, out, noise) => noiseBurst(ctx, out, noise, 'lowpass', 400, 0.9, 0.12),
  step: (ctx, out, noise) => noiseBurst(ctx, out, noise, 'lowpass', 700, 0.7, 0.07),
} satisfies Record<string, Synth>

export type SoundName = keyof typeof SYNTHS

// Räumliche Ortung für Sounds anderer Spieler: Richtung (auch vorne/hinten
// über HRTF) und Abschwächung mit der Entfernung
export function createPanner(ctx: BaseAudioContext, position: { x: number; y: number; z: number }) {
  const panner = ctx.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'inverse'
  panner.refDistance = 4
  panner.rolloffFactor = 1.3
  panner.maxDistance = 90
  panner.positionX.value = position.x
  panner.positionY.value = position.y
  panner.positionZ.value = position.z
  return panner
}

export class SoundFx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  muted = false

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1'
    } catch {
      // egal
    }
  }

  // Browser erlauben Audio erst nach einer Nutzeraktion (Klick auf "Spielen")
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.6
      this.master.connect(this.ctx.destination)
      this.noise = createNoiseBuffer(this.ctx)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  toggleMute() {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
      // egal
    }
  }

  play(name: SoundName, volume = 1) {
    if (!this.ctx || !this.master || !this.noise) return
    const out = this.ctx.createGain()
    out.gain.value = volume
    out.connect(this.master)
    SYNTHS[name](this.ctx, out, this.noise)
  }

  playAt(name: SoundName, position: { x: number; y: number; z: number }, volume = 1) {
    if (!this.ctx || !this.master || !this.noise) return
    const out = this.ctx.createGain()
    out.gain.value = volume
    out.connect(createPanner(this.ctx, position)).connect(this.master)
    SYNTHS[name](this.ctx, out, this.noise)
  }

  // Hörposition = Kamera, pro Frame
  updateListener(camera: THREE.Camera) {
    if (!this.ctx) return
    const listener = this.ctx.listener
    camera.getWorldDirection(forward)
    // Firefox kennt nur die alte Schnittstelle
    if (!listener.positionX) {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z)
      listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0)
      return
    }
    const t = this.ctx.currentTime
    listener.positionX.setValueAtTime(camera.position.x, t)
    listener.positionY.setValueAtTime(camera.position.y, t)
    listener.positionZ.setValueAtTime(camera.position.z, t)
    listener.forwardX.setValueAtTime(forward.x, t)
    listener.forwardY.setValueAtTime(forward.y, t)
    listener.forwardZ.setValueAtTime(forward.z, t)
    listener.upX.setValueAtTime(0, t)
    listener.upY.setValueAtTime(1, t)
    listener.upZ.setValueAtTime(0, t)
  }
}

const forward = new THREE.Vector3()

export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
