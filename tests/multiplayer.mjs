// Mehrspieler-Test mit zwei echten Browsern gegen einen lokalen Spielserver.
//
//   node tests/multiplayer.mjs          # Kern: Beitritt, Sync, Treffer, Kill, Respawn (~30s)
//   node tests/multiplayer.mjs --long   # + Menü-Austritt, eingefrorener Tab, AFK (~2.5 Min.)
//
// Mit simuliertem Ping: SIMULATED_LATENCY_MS=150 node tests/multiplayer.mjs
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import {
  startServers,
  launchBrowser,
  openGame,
  play,
  shootAt,
  teleport,
  wait,
  createChecks,
  SERVER_URL,
  SERVER_PORT,
} from './lib.mjs'

const LONG = process.argv.includes('--long')
// Aus dem Quelltext, damit der Roh-Client nicht nachgepflegt werden muss
const PROTOCOL_VERSION = Number(
  readFileSync(new URL('../src/shared/protocol.ts', import.meta.url), 'utf8').match(/PROTOCOL_VERSION = (\d+)/)[1]
)
const serverEnv = {}
for (const key of ['SIMULATED_LATENCY_MS', 'SIMULATED_JITTER_MS']) {
  if (process.env[key]) serverEnv[key] = process.env[key]
}
// Bei simuliertem Ping brauchen Nachrichten länger - Wartezeiten strecken
const LAG = Number(process.env.SIMULATED_LATENCY_MS ?? 0) + Number(process.env.SIMULATED_JITTER_MS ?? 0) * 2

const { check, finish } = createChecks()
const servers = await startServers({ serverEnv })
const browser = await launchBrowser()
const errors = []
const serverCount = async () => (await (await fetch(`http://localhost:${SERVER_PORT}`)).text()).match(/(\d+)\/8/)?.[1]
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  const hud = (page) => page.locator('#net-status').textContent()
  const state = (page) =>
    page.evaluate(() => ({
      id: __dusk.network.localId,
      team: __dusk.player.team,
      hp: __dusk.player.getHealthState().current,
      shield: Math.round(__dusk.player.getShieldState().current),
      alive: __dusk.player.isAlive,
      roster: [...__dusk.network.roster.values()].map((r) => `${r.name}:${r.kills}/${r.deaths}`).sort(),
      score: `${document.querySelector('#score-red').textContent}:${document.querySelector('#score-blue').textContent}`,
      feed: document.querySelector('#kill-feed').textContent,
    }))

  await wait(1000)
  check('Startbildschirm tritt nicht bei', (await serverCount()) === '0', `Server ${await serverCount()}/8`)

  await play(A)
  await play(B)
  await wait(1500 + LAG * 2)
  const a0 = await state(A)
  const b0 = await state(B)
  check('beide beigetreten', (await hud(A)).startsWith('Online · 2/8'), await hud(A))
  check('verschiedene Teams', a0.team !== b0.team, `${a0.team}/${b0.team}`)
  check('Namen in der Tabelle', a0.roster.join() === 'Anna:0/0,Ben:0/0', a0.roster.join())

  // Positions-Sync: B steht bei (0,5), A sieht B's Hülle dort
  await wait(2200) // Spawn-Schutz nach dem Beitritt abwarten
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(600 + LAG * 2)
  const seen = await A.evaluate((id) => __dusk.remotePlayers.getPosition(id)?.toArray(), b0.id)
  check('A sieht B an der richtigen Stelle', seen && Math.abs(seen[0]) < 0.05 && Math.abs(seen[2] - 5) < 0.05, JSON.stringify(seen))

  // Treffer: 2 Schüsse = 30 Schaden, Schild (25) fängt zuerst ab
  await B.evaluate(() => {
    window.__tracers = 0
    const original = __dusk.weapon.showRemoteTracer.bind(__dusk.weapon)
    __dusk.weapon.showRemoteTracer = (from, to) => {
      window.__tracers++
      original(from, to)
    }
  })
  for (let i = 0; i < 2; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(400 + LAG * 2)
  const b1 = await state(B)
  check('2 Treffer -> Schild 0, HP 95', b1.hp === 95 && b1.shield === 0, `HP ${b1.hp}, Schild ${b1.shield}`)
  check('B sieht A\'s Leuchtspuren', (await B.evaluate(() => window.__tracers)) === 2)

  // Kill: weitere 7 Treffer
  for (let i = 0; i < 7; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(500 + LAG * 2)
  const a2 = await state(A)
  const b2 = await state(B)
  check('9 Treffer -> B tot', !b2.alive)
  check('Kill-Feed mit Namen', b2.feed.includes('Anna ✕ Du') && a2.feed.includes('Du ✕ Ben'), `${a2.feed} | ${b2.feed}`)
  check('Punktestand + Tabelle', a2.roster.join() === 'Anna:1/0,Ben:0/1', `${a2.score} ${a2.roster.join()}`)
  await wait(3300 + LAG * 2)
  const b3 = await state(B)
  check('Respawn nach 3s mit vollen Werten', b3.alive && b3.hp === 100 && b3.shield === 25)

  if (LONG) {
    // Menü: nach 20s raus aus dem Spiel, Klick auf "Spielen" -> wieder drin
    await A.evaluate(() => document.exitPointerLock())
    await wait(21000)
    check('A nach 20s im Menü ausgetreten', (await state(B)).roster.join() === 'Ben:0/1', (await state(B)).roster.join())
    await play(A)
    await wait(1500 + LAG * 2)
    check('A per Klick wieder beigetreten', (await hud(A)).startsWith('Online · 2/8'), await hud(A))

    // Eingefrorener Tab: Verbindung steht, aber es kommen keine Zustände mehr
    const ghost = new WebSocket(SERVER_URL)
    ghost.on('open', () => ghost.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION, name: 'Geist' })))
    await wait(1000 + LAG)
    check('Geist beigetreten', (await state(A)).roster.some((r) => r.startsWith('Geist')))
    await wait(16000)
    check('Geist nach 15s ohne Zustände entfernt', !(await state(A)).roster.some((r) => r.startsWith('Geist')))
    ghost.close()

    // AFK: 90s ohne Aktion -> Startbildschirm mit Hinweis
    let kicked = false
    for (let i = 0; i < 100 && !kicked; i++) {
      await wait(1000)
      kicked = await A.evaluate(() => document.querySelector('#overlay-notice').textContent !== '')
    }
    check('A nach 90s AFK zurück auf dem Startbildschirm', kicked)
  }

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}

