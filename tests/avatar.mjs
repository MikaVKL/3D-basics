// Spielerfigur: Laufanimation, Duck-Pose, Tod (unsichtbar + nicht mehr
// treffbar), eigene Figur nicht in der Szene.
//
//   node tests/avatar.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []
try {
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800) // Beitritt + Spawn-Schutz
  const bId = await B.evaluate(() => __dusk.network.localId)

  // Wie A die Figur von B sieht
  const avatarOfB = () =>
    A.evaluate((id) => {
      const avatar = __dusk.remotePlayers.players.get(id).avatar
      return {
        leg: avatar.leftLeg.rotation.x,
        upperBodyY: avatar.upperBody.position.y,
        visible: avatar.root.visible,
        hitboxVisible: avatar.mesh.visible,
        color: avatar.teamMaterial.color.getHexString(),
      }
    }, bId)
  const bTeam = await B.evaluate(() => __dusk.player.team)
  check('Figur in Teamfarbe', (await avatarOfB()).color === (bTeam === 'red' ? 'ff4d5a' : '4da6ff'))
  check(
    'eigene Figur nicht in der Szene (Kamera säße im Kopf)',
    await A.evaluate(() => {
      let found = false
      __dusk.camera.parent.traverse((object) => {
        if (object.userData.damageable === __dusk.player) found = true
      })
      return !found
    })
  )

  // Laufen: A sammelt die Beinstellung von B über 2.5s
  await teleport(B, 0, 1.7, 8)
  await wait(500)
  await B.evaluate(() => __dusk.player.setMoveInput(0, 1))
  const legs = []
  for (let i = 0; i < 25; i++) {
    legs.push((await avatarOfB()).leg)
    await wait(100)
  }
  await B.evaluate(() => __dusk.player.setMoveInput(0, 0))
  const swing = Math.max(...legs) - Math.min(...legs)
  check('Beine schwingen beim Laufen', swing > 0.5, `Spanne ${swing.toFixed(2)} rad`)
  await wait(1500)
  const restLeg = Math.abs((await avatarOfB()).leg)
  check('Beine in Ruhe, wenn B steht', restLeg < 0.05, `${restLeg.toFixed(3)} rad`)

  // Ducken
  await B.evaluate(() => __dusk.player.setCrouching(true))
  await wait(800)
  const crouched = await avatarOfB()
  await B.evaluate(() => __dusk.player.setCrouching(false))
  check('Duck-Pose: Oberkörper abgesenkt', crouched.upperBodyY < -0.4, `y ${crouched.upperBodyY.toFixed(2)}`)
  await wait(800)

  // Tod: Figur und Trefferfläche weg, Schüsse gehen durch
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  await wait(700)
  for (let i = 0; i < 9; i++) {
    await shootAt(A, [0, 0.9, 5])
    await wait(150)
  }
  await wait(600)
  const dead = await avatarOfB()
  check('tote Figur unsichtbar', !dead.visible && !dead.hitboxVisible)
  await A.evaluate(() => {
    window.__hits = 0
    const original = __dusk.network.sendHit.bind(__dusk.network)
    __dusk.network.sendHit = (id) => {
      window.__hits++
      original(id)
    }
  })
  await shootAt(A, [0, 0.9, 5])
  check('Schuss geht durch die tote Figur', (await A.evaluate(() => window.__hits)) === 0)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
