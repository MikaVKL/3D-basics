// Friendly Fire (vorerst Standard des Servers, FRIENDLY_FIRE=off schaltet es aus): Teamkameraden nehmen Schaden,
// ein Teamkill zählt nicht für den Punktestand, beim ausgeschalteten Server bleibt der Schutz.
//
//   node tests/friendly-fire.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, shootAt, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const browser = await launchBrowser()
const errors = []

// Zwei Spieler im selben Team (Rot); gibt Seiten und Hilfen zurück
async function join(serverEnv) {
  const servers = await startServers({ serverEnv })
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { team: 'red' })
  await play(B, { team: 'red' })
  await wait(3800) // Spawn-Schutz
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 9)
  await wait(500)
  const bId = await B.evaluate(() => __dusk.network.localId)
  return {
    servers, A, B,
    teams: await Promise.all([A, B].map((p) => p.evaluate(() => __dusk.player.team))),
    flags: await Promise.all([A, B].map((p) => p.evaluate(() => __dusk.weapon.friendlyFire))),
    shoot: async (n, headshot = false) => {
      for (let i = 0; i < n; i++) {
        await A.evaluate(([id, head]) => __dusk.network.sendHit(id, head), [bId, headshot])
        await wait(300)
      }
      await wait(500)
      return B.evaluate(() => ({ health: __dusk.player.vitals.health, shield: __dusk.player.vitals.shield, alive: __dusk.player.isAlive }))
    },
    score: () => A.evaluate(() => document.querySelector('#score-red').textContent + ':' + document.querySelector('#score-blue').textContent),
    close: async () => { servers.stop(); await A.close(); await B.close() },
  }
}

try {
  let r = await join({})
  check('Beide im selben Team (Rot)', r.teams.join() === 'red,red', r.teams.join())
  check('Server meldet Friendly Fire im welcome, Client übernimmt es', r.flags.join() === 'true,true', r.flags.join())
  const hurt = await r.shoot(1)
  check('Teamkamerad nimmt Schaden', hurt.shield + hurt.health < 125, JSON.stringify(hurt))
  // Echter Schuss des Clients (Fadenkreuz auf den Teamkameraden): der Client darf ihn treffen und meldet es
  const before = await r.B.evaluate(() => __dusk.player.vitals.health + __dusk.player.vitals.shield)
  await wait(1500) // Schild lädt nicht in 1,5 s, Feuerpause vorbei
  await shootAt(r.A, [0, 1.0, 5])
  await wait(700)
  const afterShot = await r.B.evaluate(() => __dusk.player.vitals.health + __dusk.player.vitals.shield)
  check('Echter Schuss trifft den Teamkameraden (Client lässt es zu)', afterShot < before, `${before} -> ${afterShot}`)
  const dead = await r.shoot(5, true)
  check('Teamkill möglich, Punktestand bleibt 0:0', !dead.alive && (await r.score()) === '0:0', JSON.stringify(dead) + ' ' + (await r.score()))
  await r.close()

  r = await join({ FRIENDLY_FIRE: 'off' })
  check('FRIENDLY_FIRE=off: Client bekommt false', r.flags.join() === 'false,false', r.flags.join())
  const safe = await r.shoot(3, true)
  check('FRIENDLY_FIRE=off: Teamkamerad bleibt unverletzt', safe.health === 100 && safe.shield >= 25 && safe.alive, JSON.stringify(safe))
  await r.close()
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  finish()
}
