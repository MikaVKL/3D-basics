// Waffenauswahl online: Server kennt die gewählten Waffen (Hallo-Nachricht), lässt nur diese als
// "gehaltene Waffe" zu (Schaden nach der gültigen Waffe), neue Wahl gilt erst ab dem nächsten Spawn.
//
//   node tests/loadout.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { primary: 'shotgun', secondary: 'heavyPistol' })
  await play(B, { primary: 'sniper', secondary: 'pistol' })
  await wait(3800)
  const aId = await A.evaluate(() => __dusk.network.localId)
  const heldByA = () => B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, aId)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals, alive: __dusk.player.isAlive }))
  const hitB = (headshot = false) =>
    A.evaluate((h) => {
      const id = [...__dusk.network.remotePlayers][0]
      __dusk.network.sendHit(id, h)
    }, headshot)
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 9)
  await wait(500)

  check('B sieht A mit der gewählten Secondary (Schwere Pistole)', (await heldByA()) === 'heavyPistol', await heldByA())

  // Gültige Waffe aus dem Loadout: Shotgun (Primary) wird übernommen
  await A.evaluate(() => (__dusk.player.weapon = 'shotgun'))
  await wait(500)
  check('Waffe aus dem Loadout (Shotgun) wird übernommen', (await heldByA()) === 'shotgun', await heldByA())

  // Ungültige Waffe (Sniper, nicht gewählt): Server setzt die erste Waffe ein, Schaden nach dieser
  await A.evaluate(() => (__dusk.player.weapon = 'sniper'))
  await wait(500)
  check('Nicht gewählte Waffe (Sniper) wird abgelehnt: Server ersetzt sie', (await heldByA()) === 'heavyPistol', await heldByA())
  await hitB()
  await wait(400)
  const after = await vitals()
  // heavyPistol 45: Schild 25 weg, 20 aufs Leben (Sniper wäre 70)
  check('Schaden nach der gültigen Waffe: 45, nicht 70', after.shield === 0 && after.health === 80, JSON.stringify(after))

  // Neue Wahl mitten im Leben: gilt erst nach dem Respawn
  await A.evaluate(() => __dusk.network.sendLoadout({ primary: 'rifle', secondary: 'pistol' }))
  await wait(400)
  await A.evaluate(() => (__dusk.player.weapon = 'rifle'))
  await wait(500)
  check('Neue Wahl (Sturmgewehr) gilt noch nicht im laufenden Leben', (await heldByA()) === 'heavyPistol', await heldByA())

  // A stirbt: B trifft mit der Sniper in den Kopf (140 > 125)
  await B.keyboard.press('Digit2')
  await wait(700)
  await B.evaluate((id) => __dusk.network.sendHit(id, true), aId)
  await wait(3800)
  const aAlive = await A.evaluate(() => ({ alive: __dusk.player.isAlive, slots: __dusk.weapon.slots.join() }))
  check('A ist nach dem Respawn wieder da', aAlive.alive, JSON.stringify(aAlive))
  await A.evaluate(() => (__dusk.player.weapon = 'rifle'))
  await wait(500)
  check('Nach dem Respawn gilt die neue Wahl: Sturmgewehr wird übernommen', (await heldByA()) === 'rifle', await heldByA())

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
