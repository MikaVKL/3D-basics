// Kopftreffer: doppelter Schaden (vom Server bestätigt), auch geduckt am
// Kopf treffbar, Schadenszahlen (weiß/rot), eigener Ton, Kill-Feed-Markierung.
//
//   node tests/headshot.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []

const vitals = (page) => page.evaluate(() => ({ ...__dusk.player.vitals }))
const damageNumbers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.damage-number')].map((e) => (e.classList.contains('headshot') ? 'rot ' : '') + e.textContent)
  )

try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800) // Beitritt + Spawn-Schutz
  await A.evaluate(() => {
    window.__sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      window.__sounds.push(name)
      play(name, volume)
    }
  })

  // B steht (Füße bei y=0), A zielt aus 5 m
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(700)

  await shootAt(A, [0, 0.9, 5])
  const bodyNumbers = await damageNumbers(A)
  await wait(500)
  const afterBody = await vitals(B)
  check('Körpertreffer: 15 Schaden', afterBody.shield === 10 && afterBody.health === 100, JSON.stringify(afterBody))
  check('Körpertreffer: weiße Zahl "15"', bodyNumbers.join() === '15', bodyNumbers.join())

  await shootAt(A, [0, 1.7, 5])
  const headNumbers = await damageNumbers(A)
  await wait(500)
  const afterHead = await vitals(B)
  // 30 Schaden: 10 Schild + 20 Leben
  check('Kopftreffer: 30 Schaden', afterHead.shield === 0 && afterHead.health === 80, JSON.stringify(afterHead))
  check('Kopftreffer: rote Zahl "30"', headNumbers.includes('rot 30'), headNumbers.join())
  const sounds = await A.evaluate(() => window.__sounds.filter((s) => s !== 'shot').join())
  check('Töne: erst Treffer, dann Kopftreffer', sounds === 'hit,headshot', sounds)
  await wait(400)
  check('Schadenszahlen verschwinden', (await damageNumbers(A)).length === 0)

  // Geduckt: Kopf sinkt mit, über den Kopf hinweg geht der Schuss vorbei
  await B.evaluate(() => __dusk.player.setCrouching(true))
  await wait(800)
  await A.evaluate(() => {
    window.__hits = []
    const original = __dusk.network.sendHit.bind(__dusk.network)
    __dusk.network.sendHit = (id, headshot) => {
      window.__hits.push(headshot)
      original(id, headshot)
    }
  })
  await shootAt(A, [0, 1.75, 5])
  await wait(200)
  await shootAt(A, [0, 1.12, 5])
  await wait(500)
  const crouchHits = await A.evaluate(() => window.__hits.join())
  check('geduckt: über den Kopf vorbei, Kopf tiefer treffbar', crouchHits === 'true', crouchHits)
  check('geduckter Kopftreffer zählt', (await vitals(B)).health === 50)

  // 50 Leben = noch 2 Kopftreffer
  await B.evaluate(() => __dusk.player.setCrouching(false))
  await wait(800)
  await shootAt(A, [0, 1.7, 5])
  await wait(300)
  await shootAt(A, [0, 1.7, 5])
  await wait(600)
  check('B tot nach insgesamt 1 Körper- + 4 Kopftreffern', !(await B.evaluate(() => __dusk.player.isAlive)))
  const feed = () =>
    Promise.all(
      [A, B].map((page) =>
        page.evaluate(() => [...document.querySelectorAll('.kill-entry')].map((e) => e.textContent).join(' | '))
      )
    )
  const [feedA, feedB] = await feed()
  check('Kill-Feed markiert Kopftreffer (beide Seiten)', feedA === 'Du ✕ BenKopftreffer' && feedB === 'Anna ✕ DuKopftreffer', `${feedA} / ${feedB}`)

  await wait(4500)
  check('Kill-Feed nach 5 s noch sichtbar', (await feed())[0] !== '')
  await wait(1500)
  check('Kill-Feed nach 6 s verschwunden', (await feed())[0] === '')

  // Körper-Kill ohne Markierung
  await wait(1000) // Respawn + Spawn-Schutz
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(700)
  for (let i = 0; i < 9; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(600)
  check('Körper-Kill ohne Markierung', (await feed())[0] === 'Du ✕ Ben', (await feed())[0])
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
