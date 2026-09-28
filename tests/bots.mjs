// Bot-Dauertest zur Fehlersuche: mehrere Browser-Bots spielen gegeneinander
// (laufen, springen, rutschen, Waffen wechseln, zielen, schießen), dazu
// Störungen (Menü, Neuladen, Hintergrund-Tab, eingefrorener Tab) und ein
// Bot, der dem Server kaputte Nachrichten schickt. Nebenher werden
// Invarianten geprüft; am Ende gibt es eine Liste der gefundenen Probleme.
//
//   node tests/bots.mjs [bots=4] [sekunden=180]
//   SIMULATED_LATENCY_MS=150 SIMULATED_JITTER_MS=30 node tests/bots.mjs
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'
import { startServers, launchBrowser, openGame, play, wait, SERVER_URL } from './lib.mjs'

const [BOTS = 4, SECONDS = 180] = process.argv.slice(2).map(Number)
const PROTOCOL_VERSION = Number(
  readFileSync(new URL('../src/shared/protocol.ts', import.meta.url), 'utf8').match(/PROTOCOL_VERSION = (\d+)/)[1]
)
const RESPAWN_DELAY = 3
const LATENCY_MS = Number(process.env.SIMULATED_LATENCY_MS) || 0
const JITTER_MS = Number(process.env.SIMULATED_JITTER_MS) || 0
const WARMUP_MS = 8000

let finished = false
const issues = new Map() // Art -> { count, first, examples }
const startedAt = Date.now()
function report(kind, detail) {
  const t = ((Date.now() - startedAt) / 1000).toFixed(1)
  const entry = issues.get(kind) ?? { count: 0, first: t, examples: [] }
  entry.count++
  if (entry.examples.length < 3) entry.examples.push(`[${t}s] ${detail}`)
  issues.set(kind, entry)
  if (entry.count === 1) console.log(`! ${kind}: ${detail}`)
}

// --- Bot-Gehirn (läuft in der Seite, 10x/s) ---
function installBot() {
  if (window.__bot) return
  const D = __dusk
  const Vector3 = D.camera.position.constructor
  const bot = { enabled: true, nextDecision: 0, moveX: 0, moveZ: 1, yaw: 0 }
  window.__bot = bot
  // Eigener Weg mit Uhrzeit: erkennt, ob andere uns nur verzögert sehen
  window.__trail = []
  window.__frames = 0
  const countFrame = () => {
    window.__frames++
    requestAnimationFrame(countFrame)
  }
  requestAnimationFrame(countFrame)
  setInterval(() => {
    const p = D.camera.position
    window.__trail.push([Date.now(), p.x, p.z])
    if (window.__trail.length > 40) window.__trail.shift()
  }, 50)
  // Treffer-Statistik: gemeldet vs. beim Opfer angekommen
  window.__hitsSent = 0
  window.__hurtReceived = 0
  const sendHit = D.network.sendHit.bind(D.network)
  D.network.sendHit = (id, headshot) => {
    window.__hitsSent++
    sendHit(id, headshot)
  }
  // Spawn-Statistik je Spawn-Punkt: getroffen bis 2 s nach Ende des
  // Spawn-Schutzes (2 s), gestorben innerhalb von 6 s
  window.__spawns = {}
  let lastSpawn = null
  const spawnStats = (index) => (window.__spawns[index] ??= { count: 0, hurtEarly: 0, diedEarly: 0 })
  // Woher kamen die frühen Treffer? (Schützenposition je Spawn-Punkt)
  window.__earlyShooters = []
  const onRespawn = D.network.handlers.onRespawn
  D.network.handlers.onRespawn = (id, spawnIndex, team) => {
    if (id === D.network.localId) {
      lastSpawn = { t: performance.now(), index: spawnIndex, hurt: false, shot: false }
      spawnStats(spawnIndex).count++
    }
    onRespawn(id, spawnIndex, team)
  }
  // Eigener Schuss beendet den Spawn-Schutz (Server) - für die Auswertung
  const onShot = D.weapon.onShot
  D.weapon.onShot = (...args) => {
    if (lastSpawn) lastSpawn.shot = true
    onShot?.(...args)
  }
  const onKill = D.network.handlers.onKill
  D.network.handlers.onKill = (killer, victim, ...rest) => {
    if (victim === D.network.localId && lastSpawn && performance.now() - lastSpawn.t < 6000) spawnStats(lastSpawn.index).diedEarly++
    onKill(killer, victim, ...rest)
  }
  const onHurt = D.network.handlers.onHurt
  D.network.handlers.onHurt = (by) => {
    window.__hurtReceived++
    if (lastSpawn && !lastSpawn.hurt && performance.now() - lastSpawn.t < 4000) {
      lastSpawn.hurt = true
      spawnStats(lastSpawn.index).hurtEarly++
      const from = D.remotePlayers.getGroundPosition(by)
      if (from) window.__earlyShooters.push([lastSpawn.index, Math.round(from.x), Math.round(from.z), lastSpawn.shot ? 'selbst geschossen' : 'nicht geschossen'])
    }
    onHurt(by)
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)]
  // Sichtlinie wie ein Mensch: nur Gegner, die nicht hinter Wänden/Kisten
  // stehen, werden anvisiert und beschossen (sonst feuern Bots direkt nach
  // dem Spawn blind los und beenden so ihren eigenen Spawn-Schutz)
  const walls = D.arena.solids.map((s) => s.mesh)
  const sight = new D.weapon.raycaster.constructor()
  const canSee = (target) => {
    const from = D.camera.position
    const direction = target.clone().sub(from)
    const distance = direction.length()
    sight.set(from, direction.normalize())
    sight.far = distance
    return sight.intersectObjects(walls, false).length === 0
  }
  setInterval(() => {
    const P = D.player
    const W = D.weapon
    if (!bot.enabled || !P.isAlive) {
      W.cancelFire()
      return
    }
    const now = performance.now()
    let best = null
    let bestDistance = Infinity
    // Nächster Gegner auch ohne Sicht: dorthin laufen (wie Schritte hören)
    let nearest = null
    let nearestDistance = Infinity
    for (const [id, remote] of D.remotePlayers.players) {
      const entry = D.network.roster.get(id)
      const state = remote.samples[remote.samples.length - 1]?.state
      if (!entry || entry.team === P.team || !state?.isAlive) continue
      const center = remote.avatar.centerPosition
      const distance = center.distanceTo(D.camera.position)
      const head = remote.avatar.headMesh.getWorldPosition(new Vector3())
      if (distance < nearestDistance) {
        nearest = center
        nearestDistance = distance
      }
      if (!canSee(center) && !canSee(head)) continue
      if (distance < bestDistance) {
        best = { center, head: remote.avatar.headMesh.getWorldPosition(new Vector3()) }
        bestDistance = distance
      }
    }
    if (now > bot.nextDecision) {
      bot.nextDecision = now + 400 + Math.random() * 1500
      bot.moveX = pick([-1, 0, 1])
      bot.moveZ = pick([1, 1, 1, 0, -1])
      bot.yaw = Math.random() * Math.PI * 2
      P.setSprinting(Math.random() < 0.6)
      if (Math.random() < 0.2) {
        P.setCrouching(true)
        setTimeout(() => P.setCrouching(false), 200 + Math.random() * 900)
      }
      if (Math.random() < 0.3) P.jump()
      if (Math.random() < 0.15) W.switchTo(pick(['pistol', 'rifle', 'knife']))
      if (Math.random() < 0.05) W.switchToPrevious()
      if (Math.random() < 0.05) W.reload()
    }
    if (best) {
      const aim = Math.random() < 0.3 ? best.head : best.center
      const jitter = 0.5
      D.camera.lookAt(
        aim.x + (Math.random() - 0.5) * jitter,
        aim.y + (Math.random() - 0.5) * jitter,
        aim.z + (Math.random() - 0.5) * jitter
      )
      D.lookControl.euler.setFromQuaternion(D.camera.quaternion)
      // Weit weg (oder Messer): hinlaufen, sonst seitlich ausweichen
      if (bestDistance > 10 || (W.current === 'knife' && bestDistance > 2.2)) P.setMoveInput(bot.moveX * 0.3, 1)
      else P.setMoveInput(bot.moveX, bot.moveZ)
      if (W.current === 'rifle') W.setTrigger(true)
      else {
        W.setTrigger(false)
        W.tryShoot()
      }
    } else {
      W.setTrigger(false)
      // Meist in Richtung des nächsten Gegners, sonst zufällig (um Wände herum)
      const yaw = nearest && bot.moveZ === 1 ? Math.atan2(D.camera.position.x - nearest.x, D.camera.position.z - nearest.z) : bot.yaw
      D.lookControl.euler.set(0, yaw, 0)
      D.camera.quaternion.setFromEuler(D.lookControl.euler)
      P.setMoveInput(bot.moveX, bot.moveZ)
    }
  }, 100)
}

// Zustand einer Seite für die Prüfungen
function snapshot() {
  const D = __dusk
  const P = D.player
  const N = D.network
  const W = D.weapon
  const ammo = W.getAmmoState()
  let sceneObjects = 0
  D.camera.parent.traverse(() => sceneObjects++)
  const remotes = []
  for (const [id, remote] of D.remotePlayers.players) {
    const ground = remote.avatar.root.position
    remotes.push({ id, x: ground.x, z: ground.z, visible: remote.avatar.root.visible })
  }
  const vitals = P.vitals
  return {
    time: Date.now(),
    hitsSent: window.__hitsSent ?? 0,
    spawns: window.__spawns ?? {},
    earlyShooters: window.__earlyShooters ?? [],
    hurtReceived: window.__hurtReceived ?? 0,
    frames: window.__frames ?? 0,
    trail: window.__trail ?? [],
    id: N.localId,
    status: N.status,
    alive: P.isAlive,
    hp: vitals.health,
    shield: vitals.shield,
    pos: D.camera.position.toArray(),
    team: P.team,
    weapon: W.current,
    playerWeapon: P.weapon,
    ammo: ammo.current,
    magazine: ammo.max,
    speed: P.horizontalSpeed,
    scoreText: document.querySelector('#score-red').textContent + ':' + document.querySelector('#score-blue').textContent,
    roster: [...N.roster.values()].map((r) => `${r.id}:${r.team}:${r.kills}/${r.deaths}`).sort().join(' '),
    remotes,
    effects: D.effects.count,
    damageNumbers: document.querySelectorAll('.damage-number').length,
    killEntries: document.querySelectorAll('.kill-entry').length,
    indicators: document.querySelectorAll('.damage-indicator').length,
    sceneObjects,
    heap: performance.memory?.usedJSHeapSize ?? 0,
  }
}

// --- Kaputte Nachrichten an den Server (Robustheit) ---
const GARBAGE = [
  'kein json',
  '{"t":',
  JSON.stringify(null),
  JSON.stringify([1, 2, 3]),
  JSON.stringify({ t: 'state' }),
  JSON.stringify({ t: 'state', state: { position: { x: 'a', y: 1, z: 2 } }, time: 1, life: 0 }),
  JSON.stringify({ t: 'state', state: { position: { x: 1e308, y: 1e308, z: -1e308 }, yaw: 0 }, time: 'x', life: 0 }),
  JSON.stringify({ t: 'state', state: { position: { x: 0, y: 1.7, z: 0 }, yaw: 0, health: 100, maxHealth: 100, shield: 0, maxShield: 25, weapon: 'bazooka' }, time: 5, life: 99 }),
  JSON.stringify({ t: 'hit', target: 'alle' }),
  JSON.stringify({ t: 'hit', target: 1, headshot: 'ja' }),
  JSON.stringify({ t: 'hit', target: { id: 1 } }),
  JSON.stringify({ t: 'shot', from: null, to: [1, 2], hit: 1 }),
  JSON.stringify({ t: 'shot', from: { x: 0, y: 0, z: 0 }, to: { x: 1e9, y: 0, z: 0 }, hit: true }),
  JSON.stringify({ t: 'setName', name: 'x'.repeat(10000) }),
  JSON.stringify({ t: 'setName', name: { toString: 1 } }),
  JSON.stringify({ t: 'setName', name: '<img src=x onerror=alert(1)>' }),
  JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name: 'nochmal' }),
  JSON.stringify({ t: '__proto__', constructor: { prototype: { x: 1 } } }),
  JSON.stringify({ t: 'unbekannt' }),
  JSON.stringify({ t: 'ping' }),
  JSON.stringify({ t: 'ping', time: 'jetzt' }),
  JSON.stringify({ t: 'ping', time: 1e308 }),
]
async function fuzzServer(seconds) {
  const socket = new WebSocket(SERVER_URL, { headers: { Origin: 'http://localhost:5199' } })
  await new Promise((resolve) => socket.once('open', resolve).once('error', resolve))
  if (socket.readyState !== WebSocket.OPEN) return report('Fuzz-Bot konnte nicht verbinden', '')
  socket.on('error', () => {})
  socket.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name: 'Fuzz' }))
  const end = Date.now() + seconds * 1000
  while (Date.now() < end && socket.readyState === WebSocket.OPEN) {
    socket.send(GARBAGE[Math.floor(Math.random() * GARBAGE.length)])
    if (Math.random() < 0.1) socket.send(Buffer.from([0xff, 0x00, 0x13]))
    await wait(50)
  }
  socket.close()
}

// --- Störungen ---
async function chaos(bot) {
  const page = bot.page
  const kind = ['menu', 'menu-long', 'reload', 'hidden', 'freeze'][Math.floor(Math.random() * 5)]
  bot.chaos = kind
  bot.events[kind] = (bot.events[kind] ?? 0) + 1
  try {
    if (kind === 'menu' || kind === 'menu-long') {
      await page.evaluate(() => {
        window.__bot.enabled = false
        document.exitPointerLock()
      })
      await wait(kind === 'menu' ? 2000 + Math.random() * 5000 : 22000 + Math.random() * 5000)
      await play(page)
      await page.evaluate(() => (window.__bot.enabled = true))
    } else if (kind === 'reload') {
      await page.reload()
      await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
      await page.evaluate(installBot)
      await play(page)
    } else if (kind === 'hidden') {
      const setHidden = (hidden) =>
        page.evaluate((h) => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
          document.dispatchEvent(new Event('visibilitychange'))
        }, hidden)
      await setHidden(true)
      await wait(3000 + Math.random() * 20000)
      await setHidden(false)
    } else if (kind === 'freeze') {
      // Blockiert die Seite (wie ein kurz eingefrorener Tab)
      await page.evaluate((ms) => {
        const end = Date.now() + ms
        while (Date.now() < end) {
          // warten
        }
      }, 1500 + Math.random() * 3000)
    }
  } catch (error) {
    if (!finished) report('Störung fehlgeschlagen', `${bot.name} ${kind}: ${error.message}`)
  }
  bot.chaos = null
  bot.graceUntil = Date.now() + 6000 // Wiederbeitritt, Respawn, Interpolation
}

// --- Prüfungen ---
function checkSingle(bot, s) {
  const tag = `${bot.name} (#${s.id})`
  if (!s.pos.every(Number.isFinite)) report('Position ungültig', `${tag} ${s.pos}`)
  if (s.pos[1] < -2) report('Durch den Boden gefallen', `${tag} y=${s.pos[1].toFixed(2)}`)
  if (s.hp < 0 || s.hp > 100 || s.shield < 0 || s.shield > 25) report('Leben/Schild außerhalb', `${tag} HP ${s.hp} Schild ${s.shield}`)
  if (s.ammo < 0 || (s.magazine > 0 && s.ammo > s.magazine)) report('Munition ungültig', `${tag} ${s.ammo}/${s.magazine} ${s.weapon}`)
  if (s.weapon !== s.playerWeapon) report('Waffe Spieler/Waffe uneinig', `${tag} ${s.weapon} vs ${s.playerWeapon}`)
  if (s.speed > 16) report('Unplausibles Tempo', `${tag} ${s.speed.toFixed(1)} m/s`)
  if (s.effects > 60) report('Zu viele Effekte', `${tag} ${s.effects}`)
  if (s.killEntries > 5) report('Kill-Feed zu lang', `${tag} ${s.killEntries}`)
  if (s.damageNumbers > 40) report('Schadenszahlen stauen sich', `${tag} ${s.damageNumbers}`)
  if (s.indicators > 20) report('Schadensanzeiger stauen sich', `${tag} ${s.indicators}`)
  if (s.hp > 0 !== s.alive) report('Leben und Tot-Status uneinig', `${tag} HP ${s.hp} alive ${s.alive}`)

  // Bewegung: nach 10 s ohne Fortschritt (lebendig, aktiv) Ausbruchsversuch
  const now = Date.now()
  if (!s.alive || bot.chaos || now < bot.graceUntil || !bot.anchor) bot.anchor = { t: now, pos: s.pos }
  else if (Math.hypot(s.pos[0] - bot.anchor.pos[0], s.pos[2] - bot.anchor.pos[2]) > 0.5) bot.anchor = { t: now, pos: s.pos }
  else if (now - bot.anchor.t > 10000 && !bot.probing) {
    bot.anchor = { t: now, pos: s.pos }
    void probeStuck(bot, s)
  }

  // Zu lange tot (online, aktiv, keine Rundenpause)
  if (!s.alive && s.status === 'online') bot.deadSince ??= now
  else bot.deadSince = null
  if (bot.deadSince && now - bot.deadSince > (RESPAWN_DELAY + 9) * 1000) {
    report('Bleibt tot', `${tag} seit ${((now - bot.deadSince) / 1000).toFixed(0)}s`)
    bot.deadSince = now
  }
}

// Läuft der Bot in einer der 8 Richtungen frei? (echte Physik, echte Frames)
async function probeStuck(bot, s) {
  bot.probing = true
  bot.stuckChecks = (bot.stuckChecks ?? 0) + 1
  try {
    const moved = await bot.page.evaluate(async () => {
      const D = __dusk
      window.__bot.enabled = false
      D.weapon.cancelFire()
      D.player.setCrouching(false)
      const results = []
      for (let i = 0; i < 8; i++) {
        const start = D.camera.position.clone()
        D.lookControl.euler.set(0, (i / 8) * Math.PI * 2, 0)
        D.camera.quaternion.setFromEuler(D.lookControl.euler)
        D.player.setMoveInput(0, 1)
        await new Promise((r) => setTimeout(r, 400))
        results.push(Math.hypot(D.camera.position.x - start.x, D.camera.position.z - start.z))
        if (results[i] > 0.5) break
      }
      D.player.setMoveInput(0, 0)
      window.__bot.enabled = true
      return Math.max(...results)
    })
    if (moved < 0.3) report('Steckt fest', `${bot.name} bei ${s.pos.map((v) => v.toFixed(2)).join(', ')}, max. ${moved.toFixed(2)} m in 8 Richtungen`)
  } catch {
    // Seite lädt neu
  }
  bot.probing = false
}

// Über mehrere Messungen: nur dauerhafte Abweichungen zählen (Nachrichten unterwegs)
const streaks = new Map()
const lagSamples = [] // Verzögerung bei großen, aber erklärbaren Abweichungen
let heavyLag = 0
const spawnTotals = {}
const earlyShooters = []
const allDelays = [] // stimmt erst mit mehr als der erwarteten Verzögerung (überlastete Bots)
function persistent(key, bad, needed = 4) {
  const count = bad ? (streaks.get(key) ?? 0) + 1 : 0
  streaks.set(key, count)
  return count === needed
}

function checkCross(bots, snaps) {
  const online = bots.filter((b) => snaps.get(b)?.status === 'online' && !b.chaos && Date.now() > b.graceUntil)
  for (const a of online) {
    const sa = snaps.get(a)
    for (const b of online) {
      if (a === b) continue
      const sb = snaps.get(b)
      const seen = sa.remotes.find((r) => r.id === sb.id)
      if (persistent(`fehlt ${a.name}->${b.name}`, !seen)) report('Spieler fehlt bei anderem', `${a.name} sieht ${b.name} nicht`)
      if (!seen) continue
      // Wo war B kürzlich am nächsten an dem, was A sieht? Erlaubte
      // Verzögerung: Interpolation + Ping + Sende-/Server-Takt + ein Bild bei A
      const frame = (bot) => 1000 / Math.max(1, bot.fps)
      const allowed = 100 + LATENCY_MS + JITTER_MS * 2 + 100 + frame(a) + frame(b) + 150
      let closest = Infinity
      let closestLong = Infinity
      let delay = 0
      for (const [t, x, z] of sb.trail) {
        if (t <= sa.time && t >= sa.time - 1500) closestLong = Math.min(closestLong, Math.hypot(seen.x - x, seen.z - z))
        if (t > sa.time || t < sa.time - allowed) continue
        const d = Math.hypot(seen.x - x, seen.z - z)
        if (d < closest) [closest, delay] = [d, sa.time - t]
      }
      const distance = Math.hypot(seen.x - sb.pos[0], seen.z - sb.pos[2])
      if (sb.alive && closest > 1 && closestLong <= 1) heavyLag++
      // Typische Verzögerung, nur wenn B sich deutlich bewegt (sonst passt jede Zeit)
      const recent = sb.trail.filter(([t]) => t >= sb.time - 500)
      if (sb.alive && recent.length > 1 && closest < 0.5) {
        const [t0, x0, z0] = recent[0]
        const [t1, x1, z1] = recent[recent.length - 1]
        if (Math.hypot(x1 - x0, z1 - z0) / ((t1 - t0) / 1000) > 4) allDelays.push(delay)
      }
      if (persistent(`pos ${a.name}->${b.name}`, sb.alive && closestLong > 1))
        report(
          'Position weicht dauerhaft ab',
          `${a.name} (${a.fps.toFixed(0)} FPS) sieht ${b.name} ${distance.toFixed(1)} m daneben, in den letzten ${allowed.toFixed(0)} ms nie näher als ${closest.toFixed(1)} m (1,5 s: ${closestLong.toFixed(1)} m)`
        )
      else if (sb.alive && distance > 3.5) lagSamples.push(delay)
      if (persistent(`vis ${a.name}->${b.name}`, seen.visible !== sb.alive))
        report('Sichtbarkeit falsch', `${a.name} sieht ${b.name} ${seen.visible ? 'sichtbar' : 'unsichtbar'}, alive=${sb.alive}`)
    }
  }
  if (online.length > 1) {
    const texts = new Set(online.map((b) => snaps.get(b).scoreText))
    if (persistent('scores', texts.size > 1)) report('Punktestand uneinig', [...texts].join(' vs '))
    const rosters = new Set(online.map((b) => snaps.get(b).roster))
    if (persistent('roster', rosters.size > 1)) report('Tabelle uneinig', [...rosters].join(' || '))
    // Summe aller Kills darf den Teampunktestand nicht übersteigen (Austritte senken nur die Summe)
    const s = snaps.get(online[0])
    const killSum = s.roster.split(' ').reduce((sum, r) => sum + Number(r.split(':')[2]?.split('/')[0] ?? 0), 0)
    const [red, blue] = s.scoreText.split(':').map(Number)
    if (persistent('killsum', killSum > red + blue)) report('Kills > Teampunkte', `Summe ${killSum}, Stand ${s.scoreText}`)
  }
}

// --- Ablauf ---
const servers = await startServers({ serverEnv: { KILLS_TO_WIN: '10' } })
const browser = await launchBrowser()
const bots = []
try {
  for (let i = 0; i < BOTS; i++) {
    const name = `Bot${i + 1}`
    const errors = []
    const page = await openGame(browser, { name, errors })
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.evaluate(installBot)
    await play(page)
    bots.push({ name, page, errors, events: {}, fps: 30, fpsLog: [], chaos: null, graceUntil: Date.now() + WARMUP_MS, deadSince: null })
    await wait(300)
  }
  console.log(`${BOTS} Bots spielen ${SECONDS}s ...`)

  const endAt = Date.now() + SECONDS * 1000
  let nextFuzz = Date.now() + 15000
  let firstSample = null
  let lastSample = null
  let checks = 0
  while (Date.now() < endAt) {
    if (servers.serverExitCode() !== null) {
      report('Server abgestürzt', `Exit-Code ${servers.serverExitCode()}`)
      break
    }
    // Zufällige Störung, höchstens die Hälfte der Bots gleichzeitig
    const busy = bots.filter((b) => b.chaos).length
    if (Date.now() > startedAt + WARMUP_MS && busy < BOTS / 2 && Math.random() < 0.08) {
      const idle = bots.filter((b) => !b.chaos)
      void chaos(idle[Math.floor(Math.random() * idle.length)])
    }
    if (Date.now() > nextFuzz) {
      nextFuzz = Date.now() + 30000
      void fuzzServer(5)
    }

    const snaps = new Map()
    await Promise.all(
      bots
        .filter((b) => b.chaos !== 'freeze' && b.chaos !== 'reload')
        .map(async (b) => {
          try {
            snaps.set(b, await b.page.evaluate(snapshot))
          } catch {
            // Seite lädt gerade neu
          }
        })
    )
    for (const [bot, s] of snaps) {
      // Bildrate seit der letzten Messung
      if (bot.lastFrames !== undefined && s.time > bot.lastTime) bot.fps = ((s.frames - bot.lastFrames) * 1000) / (s.time - bot.lastTime)
      bot.lastFrames = s.frames
      bot.lastTime = s.time
      bot.fpsLog.push(bot.fps)
      // Zähler der Seite beginnen nach dem Neuladen bei 0
      const delta = (key) => (bot.lastSnap && s[key] >= bot.lastSnap[key] ? s[key] - bot.lastSnap[key] : s[key])
      bot.hitsSent = (bot.hitsSent ?? 0) + delta('hitsSent')
      bot.hurtReceived = (bot.hurtReceived ?? 0) + delta('hurtReceived')
      // Spawn-Statistik: nach Neuladen beginnt die Seite bei 0
      if (bot.lastSnap) {
        for (const [index, now] of Object.entries(s.spawns)) {
          const before = bot.lastSnap.spawns[index] ?? { count: 0, hurtEarly: 0, diedEarly: 0 }
          const reloaded = now.count < before.count
          const total = (spawnTotals[index] ??= { count: 0, hurtEarly: 0, diedEarly: 0 })
          for (const key of ['count', 'hurtEarly', 'diedEarly']) total[key] += reloaded ? now[key] : now[key] - before[key]
        }
      }
      // Neue Einträge seit der letzten Messung (nach Neuladen: alle)
      const known = bot.lastSnap && s.earlyShooters.length >= bot.lastSnap.earlyShooters.length ? bot.lastSnap.earlyShooters.length : 0
      earlyShooters.push(...s.earlyShooters.slice(known))
      bot.lastSnap = s
      checkSingle(bot, s)
    }
    checkCross(bots, snaps)
    checks++
    const sample = snaps.get(bots[0])
    if (sample && Date.now() > startedAt + WARMUP_MS + 5000) {
      firstSample ??= sample
      lastSample = sample
    }
    for (const bot of bots) {
      for (const error of bot.errors.splice(0)) report('Fehler im Browser', `${bot.name}: ${error}`)
    }
    await wait(1000)
  }

  // Wachstum über die Laufzeit (Speicherlecks)
  if (firstSample && lastSample) {
    const objects = lastSample.sceneObjects - firstSample.sceneObjects
    if (objects > 150) report('Szene wächst', `${firstSample.sceneObjects} -> ${lastSample.sceneObjects} Objekte`)
    const heapGrowth = lastSample.heap / firstSample.heap
    if (heapGrowth > 1.6) report('Speicher wächst', `${(firstSample.heap / 1e6).toFixed(0)} -> ${(lastSample.heap / 1e6).toFixed(0)} MB`)
    console.log(
      `Szene ${firstSample.sceneObjects} -> ${lastSample.sceneObjects} Objekte, Heap ${(firstSample.heap / 1e6).toFixed(0)} -> ${(lastSample.heap / 1e6).toFixed(0)} MB`
    )
  }
  const serverErrors = servers.serverErrors().trim()
  if (serverErrors) report('Server-Fehlerausgabe', serverErrors.split('\n').slice(0, 3).join(' | '))

  const log = servers.serverLog()
  const kills = (log.match(/eliminiert/g) ?? []).length
  const rounds = (log.match(/Runde vorbei/g) ?? []).length
  const events = {}
  for (const bot of bots) for (const [k, v] of Object.entries(bot.events)) events[k] = (events[k] ?? 0) + v
  const hitsSent = bots.reduce((sum, b) => sum + (b.hitsSent ?? 0), 0)
  const hurtReceived = bots.reduce((sum, b) => sum + (b.hurtReceived ?? 0), 0)
  const stuckChecks = bots.reduce((sum, b) => sum + (b.stuckChecks ?? 0), 0)
  console.log(`Treffer gemeldet ${hitsSent}, beim Opfer angekommen ${hurtReceived}; Ausbruchsversuche ${stuckChecks}`)
  const spawnLines = Object.entries(spawnTotals)
    .filter(([, t]) => t.count > 0)
    .map(([index, t]) => `Spawn ${index}: ${t.count}x, früh getroffen ${Math.round((100 * t.hurtEarly) / t.count)} %, früh gestorben ${Math.round((100 * t.diedEarly) / t.count)} %`)
  if (spawnLines.length) console.log(spawnLines.join('\n'))
  if (earlyShooters.length) console.log('Frühe Treffer [Spawn, Schütze x, z, Opfer]:', JSON.stringify(earlyShooters))
  allDelays.sort((x, y) => x - y)
  const pct = (p) => allDelays[Math.floor(allDelays.length * p)]
  if (allDelays.length) console.log(`Verzögerung bei Bewegung (${allDelays.length} Messungen): Median ${pct(0.5)} ms, 90 % unter ${pct(0.9)} ms`)
  const fpsAll = bots.flatMap((b) => b.fpsLog).sort((x, y) => x - y)
  console.log(`Bildrate der Bots: Median ${fpsAll[fpsAll.length >> 1]?.toFixed(1)}, 10 % unter ${fpsAll[Math.floor(fpsAll.length / 10)]?.toFixed(1)} FPS`)
  if (lagSamples.length) {
    lagSamples.sort((x, y) => x - y)
    console.log(`Große Abweichungen durch Verzögerung: ${lagSamples.length}x, Median ${lagSamples[lagSamples.length >> 1]} ms, stärker als erwartet: ${heavyLag}x`)
  }
  console.log(`\n${checks} Prüfrunden, ${kills} Kills, ${rounds} Runden beendet, Störungen: ${JSON.stringify(events)}`)
} finally {
  finished = true
  await browser.close()
  servers.stop()
}

if (issues.size === 0) {
  console.log('Keine Probleme gefunden')
} else {
  console.log(`\n${issues.size} Problemart(en):`)
  for (const [kind, { count, examples }] of issues) {
    console.log(`- ${kind} (${count}x)`)
    for (const example of examples) console.log(`    ${example}`)
  }
  process.exitCode = 1
}
