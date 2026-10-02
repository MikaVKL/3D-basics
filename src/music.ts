// Hintergrundmusik: ein treibender, synthetisierter Loop (keine Audiodateien).
// scheduleBar() plant einen Takt auf beliebiges Ziel - live und im
// OfflineAudioContext (der Sound-Test prüft so, dass sie hörbar und sauber ist).

export const MUSIC_BPM = 140
const BEAT = 60 / MUSIC_BPM
export const BAR_SECONDS = BEAT * 4

// a-Moll, spannungsreich: Am - F - G - E - Am - F - Dm - E (E als Dur-Dominante); 16 Takte, die
// zweite Hälfte spielt die Melodie eine Oktave höher
const CHORDS = [
  { root: 45, third: 3 }, // A
  { root: 41, third: 4 }, // F
  { root: 43, third: 4 }, // G
  { root: 40, third: 4 }, // E
  { root: 45, third: 3 }, // A
  { root: 41, third: 4 }, // F
  { root: 38, third: 3 }, // D
  { root: 40, third: 4 }, // E
]
export const LOOP_BARS = 16

// Bass in 16teln: Grundton mit Oktavsprüngen; Melodie als Sechzehntel-Folge über die Akkordtöne
const BASS_OCTAVES = [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 7, 12]
const LEAD_STEPS = [0, 3, 6, 8, 11, 14] // Synkopen 3+3+2+3+3+2

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
  osc.frequency.setValueAtTime(160, start)
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.1)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.55, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(start + 0.25)
}

// Ein Takt (4 Schläge, 16 Sechzehntel) ab Zeit t0; bar zählt durch den Loop
export function scheduleBar(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, bar: number, t0: number) {
  const index = bar % LOOP_BARS
  const chord = CHORDS[index % CHORDS.length]
  const tones = [0, chord.third, 7, 12]
  const high = index >= CHORDS.length
  const STEP = BEAT / 4

  // Pad: leise, nur als Untergrund
  for (const interval of [0, chord.third, 7]) {
    note(ctx, out, { type: 'sawtooth', freq: hz(chord.root + 12 + interval), start: t0, duration: BAR_SECONDS + 0.2, peak: 0.01, attack: 0.3, cutoff: 1100 })
  }

  // Bass: hartes Sechzehntel-Pulsieren, kurz abgesetzt, dazu ein Sub-Ton auf jedem Schlag
  for (let i = 0; i < 16; i++) {
    note(ctx, out, {
      type: 'sawtooth',
      freq: hz(chord.root + BASS_OCTAVES[i]),
      start: t0 + i * STEP,
      duration: STEP * 0.8,
      peak: 0.07,
      attack: 0.004,
      cutoff: 750,
    })
  }
  for (let beat = 0; beat < 4; beat++) {
    note(ctx, out, { type: 'sine', freq: hz(chord.root - 12), start: t0 + beat * BEAT, duration: BEAT * 0.9, peak: 0.1, attack: 0.005, cutoff: 300 })
  }

  // Melodie: scharfe Sägezahn-Stiche auf den Synkopen, in der zweiten Takt-Hälfte der Phrase ein Arpeggio dazu
  for (const step of LEAD_STEPS) {
    const interval = tones[(step + index) % tones.length]
    note(ctx, out, {
      type: 'sawtooth',
      freq: hz(chord.root + (high ? 36 : 24) + interval),
      start: t0 + step * STEP,
      duration: STEP * 1.6,
      peak: 0.03,
      attack: 0.004,
      cutoff: 3200,
      detune: 9,
    })
  }
  if (index % 2 === 1) {
    for (let i = 0; i < 16; i++) {
      if (LEAD_STEPS.includes(i)) continue
      note(ctx, out, { type: 'square', freq: hz(chord.root + 36 + tones[i % tones.length]), start: t0 + i * STEP, duration: STEP * 0.6, peak: 0.012, attack: 0.003, cutoff: 2400 })
    }
  }

  // Schlagzeug: Kick auf jedem Schlag, Snare auf 2 und 4, Hi-Hats in Sechzehnteln (Achtel betont);
  // vor dem Phrasenende (Takt 8 und 16) ein Snare-Wirbel
  for (let beat = 0; beat < 4; beat++) kick(ctx, out, t0 + beat * BEAT)
  if (index % 2 === 1) kick(ctx, out, t0 + 3.5 * BEAT) // Synkope vor dem nächsten Takt
  const fill = index % 8 === 7
  for (const beat of [1, 3]) {
    drum(ctx, out, noise, 'bandpass', 1800, t0 + beat * BEAT, 0.3, 0.14)
    note(ctx, out, { type: 'triangle', freq: 200, start: t0 + beat * BEAT, duration: 0.09, peak: 0.12, attack: 0.002, cutoff: 1500 })
  }
  if (fill) {
    for (let i = 0; i < 8; i++) drum(ctx, out, noise, 'bandpass', 1800, t0 + 3 * BEAT + (i * BEAT) / 8, 0.1 + i * 0.03, 0.06)
  }
  for (let i = 0; i < 16; i++) drum(ctx, out, noise, 'highpass', 7500, t0 + i * STEP, i % 2 === 0 ? 0.07 : 0.04, 0.035)
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
