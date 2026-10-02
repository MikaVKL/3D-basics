// Alle Sounds werden per Web Audio synthetisiert (keine Audiodateien).
// Jede Synth-Funktion spielt auf ein beliebiges Ziel - live oder in einem
// OfflineAudioContext (Tests prüfen so, dass jeder Sound hörbar ist).

import * as THREE from 'three'
import { Music } from './music'

type Synth = (ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer) => void

const MUTE_STORAGE_KEY = 'duskArena.muted'
const MUSIC_LEVEL = 0.5 // Musik liegt bei Regler 100 % noch deutlich unter den Effekten

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
  // Sturmgewehr: kürzer, tiefer und kerniger als die Pistole (Dauerfeuer)
  rifleShot: (ctx, out, noise) => {
    tone(ctx, out, 'square', 700, 120, 0.22, 0.09)
    noiseBurst(ctx, out, noise, 'bandpass', 1400, 0.35, 0.07)
  },
  // Shotgun: tiefer Knall mit langem Rauschen, kurz danach der Pumpgriff
  shotgunShot: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 1600, 0.9, 0.28)
    noiseBurst(ctx, out, noise, 'bandpass', 700, 0.5, 0.18)
    tone(ctx, out, 'sawtooth', 320, 50, 0.45, 0.22)
    tone(ctx, out, 'sine', 90, 35, 0.6, 0.3)
  },
  shotgunPump: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 1500, 0.5, 0.04)
    tone(ctx, out, 'square', 200, 100, 0.14, 0.06)
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.55, 0.035, 0.2)
    tone(ctx, out, 'square', 260, 130, 0.14, 0.05, 0.2)
  },
  // Schrotpatrone einschieben (Start des Nachladens) und Pumpgriff am Ende
  shotgunReloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 2000, 0.4, 0.03)
    tone(ctx, out, 'triangle', 500, 300, 0.12, 0.07, 0.04)
    noiseBurst(ctx, out, noise, 'bandpass', 2800, 0.35, 0.03, 0.4)
    noiseBurst(ctx, out, noise, 'bandpass', 2600, 0.35, 0.03, 0.8)
  },
  shotgunReloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 1500, 0.5, 0.04)
    tone(ctx, out, 'square', 190, 95, 0.14, 0.06)
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.55, 0.035, 0.22)
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.3) // fertig-"Ping"
  },
  // Sniper: harter Knall mit Nachhall, danach der Repetiergriff (sniperBolt)
  sniperShot: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'highpass', 3000, 0.4, 0.05)
    tone(ctx, out, 'sawtooth', 1100, 70, 0.3, 0.3)
    noiseBurst(ctx, out, noise, 'lowpass', 900, 0.5, 0.35)
    tone(ctx, out, 'sine', 80, 30, 0.35, 0.4)
    noiseBurst(ctx, out, noise, 'lowpass', 400, 0.15, 0.5, 0.12) // Nachhall
  },
  sniperBolt: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 1800, 0.5, 0.04)
    tone(ctx, out, 'square', 320, 150, 0.14, 0.06)
    noiseBurst(ctx, out, noise, 'bandpass', 1400, 0.3, 0.05, 0.12) // Hülse fällt
    noiseBurst(ctx, out, noise, 'bandpass', 2400, 0.55, 0.04, 0.26)
    tone(ctx, out, 'square', 240, 110, 0.15, 0.06, 0.26)
  },
  sniperReloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.4, 0.04)
    tone(ctx, out, 'square', 300, 130, 0.13, 0.1, 0.03)
    noiseBurst(ctx, out, noise, 'lowpass', 450, 0.45, 0.1, 0.1)
  },
  sniperReloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.5, 0.09)
    tone(ctx, out, 'square', 200, 100, 0.12, 0.07)
    noiseBurst(ctx, out, noise, 'bandpass', 2400, 0.5, 0.04, 0.2) // Repetiergriff
    tone(ctx, out, 'square', 230, 105, 0.14, 0.06, 0.34)
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.45) // fertig-"Ping"
  },
  // Schwere Pistole: tiefer und wuchtiger als die normale
  heavyShot: (ctx, out, noise) => {
    tone(ctx, out, 'sawtooth', 900, 90, 0.35, 0.2)
    noiseBurst(ctx, out, noise, 'lowpass', 1400, 0.5, 0.16)
    tone(ctx, out, 'sine', 110, 40, 0.45, 0.2)
    noiseBurst(ctx, out, noise, 'highpass', 3000, 0.15, 0.04)
  },
  heavyReloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.4, 0.035)
    tone(ctx, out, 'square', 320, 130, 0.13, 0.1, 0.03)
    noiseBurst(ctx, out, noise, 'lowpass', 420, 0.45, 0.1, 0.09)
  },
  heavyReloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.5, 0.08)
    tone(ctx, out, 'square', 210, 100, 0.12, 0.07)
    noiseBurst(ctx, out, noise, 'bandpass', 2600, 0.5, 0.03, 0.16) // Schlitten
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.22) // fertig-"Ping"
  },
  // Maschinenpistole: kurz und hell, noch schneller als das Sturmgewehr
  smgShot: (ctx, out, noise) => {
    tone(ctx, out, 'square', 950, 200, 0.18, 0.06)
    noiseBurst(ctx, out, noise, 'bandpass', 2000, 0.3, 0.045)
  },
  smgReloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 2400, 0.4, 0.03)
    tone(ctx, out, 'square', 380, 160, 0.11, 0.08, 0.03)
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.4, 0.07, 0.08)
  },
  smgReloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 600, 0.45, 0.07)
    noiseBurst(ctx, out, noise, 'bandpass', 3000, 0.4, 0.03, 0.1) // Spannen
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.15) // fertig-"Ping"
  },
  // Nachladen: Energiezelle löst sich (Anfang) und rastet wieder ein (Ende);
  // zwei getrennte Töne, damit sie zur Nachladezeit der Waffe passen
  reloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 2600, 0.4, 0.03)
    tone(ctx, out, 'square', 420, 170, 0.12, 0.09, 0.03)
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.4, 0.08, 0.08)
  },
  reloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 600, 0.45, 0.07)
    noiseBurst(ctx, out, noise, 'bandpass', 3000, 0.4, 0.03, 0.09)
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.13) // fertig-"Ping"
  },
  // Sturmgewehr: schwerer - Magazin klackt aus dem Schacht, am Ende rastet es
  // ein und der Spannhebel ratscht (zweiteilig, "chk-chk")
  rifleReloadOut: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 1800, 0.45, 0.04)
    tone(ctx, out, 'square', 260, 110, 0.14, 0.12, 0.03)
    noiseBurst(ctx, out, noise, 'lowpass', 400, 0.5, 0.1, 0.1)
    noiseBurst(ctx, out, noise, 'highpass', 3500, 0.2, 0.03, 0.2) // Magazin streift
  },
  rifleReloadIn: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.55, 0.09)
    tone(ctx, out, 'square', 180, 90, 0.12, 0.08)
    noiseBurst(ctx, out, noise, 'bandpass', 2400, 0.45, 0.025, 0.14) // Hebel zurück
    noiseBurst(ctx, out, noise, 'bandpass', 3200, 0.5, 0.025, 0.24) // Hebel vor
    tone(ctx, out, 'square', 650, 1150, 0.1, 0.07, 0.3) // fertig-"Ping"
  },
  // Waffe ziehen (Wechsel): Luftzug, dann Klick / beim Messer ein helles Zischen
  drawGun: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'highpass', 1200, 0.3, 0.09)
    noiseBurst(ctx, out, noise, 'bandpass', 2800, 0.4, 0.03, 0.07)
    tone(ctx, out, 'triangle', 320, 200, 0.1, 0.05, 0.07)
  },
  drawKnife: (ctx, out, noise) => {
    tone(ctx, out, 'sine', 2200, 3300, 0.1, 0.14)
    noiseBurst(ctx, out, noise, 'highpass', 4000, 0.25, 0.12)
  },
  // Abdrücken ohne Schuss (z. B. beim Nachladen): leiser Klick
  dryFire: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'bandpass', 3500, 0.35, 0.015)
    tone(ctx, out, 'square', 1200, 900, 0.05, 0.02)
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
  // Messer: kurzes, nach oben gezogenes Zischen
  knife: (ctx, out, noise) => {
    const source = ctx.createBufferSource()
    source.buffer = noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 2
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(900, t)
    filter.frequency.exponentialRampToValueAtTime(4500, t + 0.15)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    source.connect(filter).connect(gain).connect(out)
    source.start(t)
    source.stop(t + 0.2)
  },
  jump: (ctx, out) => tone(ctx, out, 'sine', 220, 440, 0.12, 0.1),
  land: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 400, 0.9, 0.12)
    tone(ctx, out, 'sine', 110, 55, 0.5, 0.12)
  },
  landMetal: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.8, 0.1)
    noiseBurst(ctx, out, noise, 'bandpass', 2200, 0.5, 0.18)
    tone(ctx, out, 'triangle', 420, 380, 0.25, 0.25)
  },
  // Schritte: jedes Mal leicht anders (Tonhöhe, Länge, Anschlag), sonst klingt
  // es wie eine Maschine. Boden dumpf, Steg/Brücke (obere Ebene) hohl-metallisch.
  step: (ctx, out, noise) => {
    const k = 0.85 + Math.random() * 0.3
    noiseBurst(ctx, out, noise, 'lowpass', 600 * k, 0.7, 0.06 + Math.random() * 0.03)
    noiseBurst(ctx, out, noise, 'highpass', 3000, 0.15, 0.02)
    tone(ctx, out, 'sine', 90 * k, 60, 0.25, 0.06)
  },
  stepMetal: (ctx, out, noise) => {
    const k = 0.9 + Math.random() * 0.25
    noiseBurst(ctx, out, noise, 'bandpass', 1800 * k, 0.45, 0.05)
    noiseBurst(ctx, out, noise, 'lowpass', 500, 0.35, 0.05)
    tone(ctx, out, 'triangle', 330 * k, 300 * k, 0.12, 0.16)
  },
  // Rutschen: abfallendes Schleifen über den Boden
  slide: (ctx, out, noise) => {
    const source = ctx.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(1800, t)
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.6)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    source.connect(filter).connect(gain).connect(out)
    source.start(t)
    source.stop(t + 0.62)
  },
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
  private musicGain: GainNode | null = null
  music: Music | null = null
  muted = false
  volume = 1 // Einstellung 0..1, wirkt auf die Gesamtlautstärke
  musicVolume = 0.5 // Einstellung 0..1, nur die Hintergrundmusik

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
      this.master.gain.value = this.masterGain()
      this.master.connect(this.ctx.destination)
      this.noise = createNoiseBuffer(this.ctx)
      this.musicGain = this.ctx.createGain()
      this.musicGain.gain.value = this.musicVolume * MUSIC_LEVEL
      this.musicGain.connect(this.master)
      this.music = new Music(this.ctx, this.musicGain, this.noise)
      this.music.start()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private masterGain() {
    return this.muted ? 0 : 0.6 * this.volume
  }

  setVolume(volume: number) {
    this.volume = volume
    if (this.master) this.master.gain.value = this.masterGain()
  }

  setMusicVolume(volume: number) {
    this.musicVolume = volume
    if (this.musicGain) this.musicGain.gain.value = volume * MUSIC_LEVEL
  }

  toggleMute() {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.masterGain()
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
