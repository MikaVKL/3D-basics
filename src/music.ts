// Hintergrundmusik: ein synthetisierter Synthwave-Loop (keine Audiodateien).
// scheduleBar() plant einen Takt auf beliebiges Ziel - live und im
// OfflineAudioContext (der Sound-Test prüft so, dass sie hörbar und sauber ist).

export const MUSIC_BPM = 96
const BEAT = 60 / MUSIC_BPM
export const BAR_SECONDS = BEAT * 4

// a-Moll: Am - F - C - G, vier Takte; die zweite Hälfte spielt das Arpeggio eine Oktave höher
const CHORDS = [
  { root: 45, third: 3 }, // A
  { root: 41, third: 4 }, // F
  { root: 48, third: 4 }, // C
  { root: 43, third: 4 }, // G
]
export const LOOP_BARS = 8

const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 1]

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

interface NoteOptions {
  type: OscillatorType
  freq: number
  start: number
  duration: number
  peak: number
  attack?: number
  cutoff?: number
  detune?: number
}

function note(ctx: BaseAudioContext, out: AudioNode, o: NoteOptions) {
  const osc = ctx.createOscillator()
  osc.type = o.type
  osc.frequency.value = o.freq
  if (o.detune) osc.detune.value = o.detune
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = o.cutoff ?? 2000
  const gain = ctx.createGain()
  const attack = o.attack ?? 0.01
  gain.gain.setValueAtTime(0.0001, o.start)
  gain.gain.linearRampToValueAtTime(o.peak, o.start + attack)
  gain.gain.setValueAtTime(o.peak, o.start + Math.max(attack, o.duration - 0.12))
  gain.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration)
  osc.connect(filter).connect(gain).connect(out)
  osc.start(o.start)
  osc.stop(o.start + o.duration + 0.02)
}

function drum(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  filterType: BiquadFilterType,
  frequency: number,
  start: number,
  peak: number,
  duration: number
) {
  const source = ctx.createBufferSource()
  source.buffer = noise
  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = frequency
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(peak, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  source.connect(filter).connect(gain).connect(out)
  source.start(start)
  source.stop(start + duration + 0.02)
}

function kick(ctx: BaseAudioContext, out: AudioNode, start: number) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(130, start)
  osc.frequency.exponentialRampToValueAtTime(42, start + 0.12)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.5, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(start + 0.25)
}

// Ein Takt (4 Schläge) ab Zeit t0; bar zählt durch den Loop
export function scheduleBar(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, bar: number, t0: number) {
  const index = bar % LOOP_BARS
  const chord = CHORDS[index % CHORDS.length]
  const tones = [0, chord.third, 7, 12]
  const high = index >= CHORDS.length

  // Pad: drei leicht verstimmte Sägezähne, langsam ein- und ausblendend
  for (const interval of [0, chord.third, 7]) {
    for (const detune of [-7, 7]) {
      note(ctx, out, {
        type: 'sawtooth',
        freq: hz(chord.root + 12 + interval),
        start: t0,
        duration: BAR_SECONDS + 0.4,
        peak: 0.018,
        attack: 0.9,
        cutoff: 900,
        detune,
      })
    }
  }

  // Bass: Achtel, Grundton mit Oktavsprung
  for (let i = 0; i < 8; i++) {
    const octave = i === 3 || i === 7 ? 12 : 0
    note(ctx, out, {
      type: 'sawtooth',
      freq: hz(chord.root + octave),
      start: t0 + i * BEAT * 0.5,
      duration: BEAT * 0.45,
      peak: 0.07,
      cutoff: 420,
    })
  }

  // Arpeggio: weiche Dreiecke, in der zweiten Hälfte eine Oktave höher
  for (let i = 0; i < 8; i++) {
    const interval = tones[ARP_PATTERN[i] % tones.length]
    note(ctx, out, {
      type: 'triangle',
      freq: hz(chord.root + (high ? 36 : 24) + interval),
      start: t0 + i * BEAT * 0.5,
      duration: BEAT * 0.4,
      peak: 0.035,
      cutoff: 2600,
    })
  }

  // Schlagzeug, bewusst leise: Kick auf 1 und 3, Klatscher auf 2 und 4, Hi-Hat auf den Achteln dazwischen
  kick(ctx, out, t0)
  kick(ctx, out, t0 + BEAT * 2)
  drum(ctx, out, noise, 'bandpass', 1600, t0 + BEAT, 0.12, 0.12)
  drum(ctx, out, noise, 'bandpass', 1600, t0 + BEAT * 3, 0.12, 0.12)
  for (let i = 0; i < 4; i++) drum(ctx, out, noise, 'highpass', 7000, t0 + BEAT * (i + 0.5), 0.05, 0.04)
}

const LOOKAHEAD = 1.2 // so weit voraus wird geplant (s)
const CHECK_INTERVAL = 300 // ms

// Läuft live: plant fortlaufend Takte, auch im Hintergrund-Tab (Timer 1/s reicht)
export class Music {
  private bar = 0
  private nextTime = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly ctx: AudioContext
  private readonly out: AudioNode
  private readonly noise: AudioBuffer

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx
    this.out = out
    this.noise = noise
  }

  get playing(): boolean {
    return this.timer !== null
  }

  start() {
    if (this.timer) return
    this.nextTime = this.ctx.currentTime + 0.1
    this.tick()
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick() {
    // Nach langer Pause (Tab eingefroren) nicht aufholen, sondern neu ansetzen
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.05
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      scheduleBar(this.ctx, this.out, this.noise, this.bar, this.nextTime)
      this.bar++
      this.nextTime += BAR_SECONDS
    }
  }
}
