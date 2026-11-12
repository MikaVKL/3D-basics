// Respawn, ohne vorher gestorben zu sein (Rundenstart, Team-Ausgleich, Wiederbeitritt): der Server beginnt ein neues
// Leben (neue Waffenwahl gilt, Gadgets bereit) - der Client muss dasselbe tun, sonst hält er Waffen, die der Server
// nicht mehr kennt (Server ersetzt sie: falscher Schaden, falsche Feuerrate, andere sehen die falsche Waffe).
//
//   node tests/respawn-alive.mjs
import { startServers, launchBrowser, openGame, play, wait, teleport, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ serverEnv: { KILLS_TO_WIN: '1', ROUND_END_PAUSE: '3' } })
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A, { team: 'red', primary: 'rifle', secondary: 'pistol' })
  await play(B, { team: 'blue', primary: 'rifle', secondary: 'pistol' })
  await wait(3800)
  const aId = await A.evaluate(() => __dusk.network.localId)
  const bId = await B.evaluate(() => __dusk.network.localId)
  const heldByA = () => B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, aId)
  const place = async () => {
    await teleport(B, 0, 1.7, 5)
    await teleport(A, 0, 1.7, 9)
    await wait(500)
  }
  await place()

  // A wählt mitten im Leben neue Waffen (wie im Pausenmenü), verbraucht Munition und wirft ein Gadget
  await A.evaluate(() => {
    document.querySelector('.weapon-card[data-weapon="shotgun"]').click()
    document.querySelector('.weapon-card[data-weapon="heavyPistol"]').click()
    __dusk.weapon.ammo = 3
    __dusk.throwGadget()
  })
  await wait(400)
  const before = await A.evaluate(() => ({ slots: __dusk.weapon.slots.join(), cooldown: __dusk.gadgets.cooldownRemaining }))
  check('Neue Wahl gilt im laufenden Leben noch nicht', before.slots === 'pistol,rifle,knife' && before.cooldown > 5, JSON.stringify(before))

  // A gewinnt die Runde (1 Kill) und überlebt; nach der Pause setzt der Server alle neu
  for (let i = 0; i < 4; i++) {
    await A.evaluate((id) => __dusk.network.sendHit(id, true), bId)
    await wait(350)
  }
  await wait(500)
  check('Runde vorbei, A lebt', await A.evaluate(() => __dusk.player.isAlive && !document.querySelector('#round-banner').classList.contains('hidden')))
  await wait(4200)

  const after = await A.evaluate(() => ({
    slots: __dusk.weapon.slots.join(),
    current: __dusk.weapon.current,
    ammo: __dusk.weapon.getAmmoState().current,
    cooldown: __dusk.gadgets.cooldownRemaining,
    alive: __dusk.player.isAlive,
  }))
  check('Neue Runde: A hält die neu gewählten Waffen', after.alive && after.slots === 'heavyPistol,shotgun,knife' && after.current === 'heavyPistol', JSON.stringify(after))
  check('Neue Runde: Magazin voll, Gadget bereit', after.ammo === 7 && after.cooldown === 0, JSON.stringify(after))

  await wait(2300) // Spawn-Schutz
  await place()
  const seen = await heldByA()
  const held = await A.evaluate(() => __dusk.weapon.current)
  check('B sieht die Waffe, die A wirklich hält', seen === held, `A hält ${held}, B sieht ${seen}`)
  await A.evaluate((id) => __dusk.network.sendHit(id, false), bId)
  await wait(400)
  const vitals = await B.evaluate(() => ({ ...__dusk.player.vitals }))
  const expected = { pistol: 20, heavyPistol: 45 }[held]
  const lost = 125 - vitals.health - vitals.shield
  check('Schaden passt zur Waffe in A\'s Hand', Math.abs(lost - expected) < 3, `A hält ${held} (${expected}), Server zog ${lost.toFixed(1)} ab`)

  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
