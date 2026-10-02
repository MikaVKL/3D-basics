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

  // Eigene Waffe leuchtet in der eigenen Teamfarbe
  for (const [label, page] of [['A', A], ['B', B]]) {
    const own = await page.evaluate(() => ({ team: __dusk.player.team, accent: __dusk.weapon.view.accent.color.getHexString(), glow: __dusk.weapon.view.accent.emissive.getHexString() }))
    const want = own.team === 'red' ? 'ff4d5a' : '4da6ff'
    check(`Waffe von ${label} in Teamfarbe (${own.team})`, own.accent === want && own.glow === want, `${own.accent}/${own.glow}`)
  }

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

  // A zeichnet jedes Bild die Figur von B auf (Fußhöhe, Pose)
  const recordB = (ms) =>
    A.evaluate(
      ([id, duration]) =>
        new Promise((resolve) => {
          const avatar = __dusk.remotePlayers.players.get(id).avatar
          const rows = []
          const start = performance.now()
          const tick = () => {
            rows.push({
              footY: avatar.root.position.y,
              upperBodyY: avatar.upperBody.position.y,
              lean: avatar.upperBody.rotation.x,
              leg: avatar.leftLeg.rotation.x,
            })
            if (performance.now() - start < duration) requestAnimationFrame(tick)
            else resolve(rows)
          }
          tick()
        }),
      [bId, ms]
    )

  // Ducken: weicher Übergang, Figur bleibt am Boden (früher hüpfte sie 0,7 m hoch)
  const crouchRecording = recordB(1000)
  await B.evaluate(() => __dusk.player.setCrouching(true))
  const crouchRows = await crouchRecording
  const crouched = await avatarOfB()
  const standRecording = recordB(1000)
  await B.evaluate(() => __dusk.player.setCrouching(false))
  const standRows = await standRecording
  check('Duck-Pose: Oberkörper abgesenkt', crouched.upperBodyY < -0.5, `y ${crouched.upperBodyY.toFixed(2)}`)
  const footRange = [...crouchRows, ...standRows].map((r) => Math.abs(r.footY))
  check('Ducken/Aufstehen: Figur bleibt am Boden', Math.max(...footRange) < 0.02, `max ${Math.max(...footRange).toFixed(2)} m`)
  const midPose = crouchRows.filter((r) => r.upperBodyY < -0.05 && r.upperBodyY > -0.5).length
  check('Ducken: weicher Übergang', midPose >= 1, `${midPose} Zwischenbilder`)

  // Rutschen: B sprintet und duckt sich; A sieht die Rutsch-Pose, B die Rutsch-Sicht
  await teleport(B, 0, 1.7, 14)
  await B.evaluate(() => {
    __dusk.camera.lookAt(0, 1.7, 0)
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
  })
  await wait(500)
  const slideRecording = recordB(1500)
  const ownView = await B.evaluate(async () => {
    const P = __dusk.player
    P.setSprinting(true)
    P.setMoveInput(0, 1)
    await new Promise((r) => setTimeout(r, 400))
    P.setCrouching(true)
    let maxAmount = 0
    let maxFov = 0
    let sliding = false
    const start = performance.now()
    while (performance.now() - start < 700) {
      await new Promise((r) => requestAnimationFrame(r))
      sliding ||= P.isSliding
      maxAmount = Math.max(maxAmount, __dusk.slideView.amount)
      maxFov = Math.max(maxFov, __dusk.camera.fov)
    }
    P.setCrouching(false)
    P.setMoveInput(0, 0)
    P.setSprinting(false)
    await new Promise((r) => setTimeout(r, 600))
    return { sliding, maxAmount, maxFov, fovAfter: __dusk.camera.fov, rollAfter: __dusk.camera.rotation.z }
  })
  const slideRows = await slideRecording
  const maxLean = Math.max(...slideRows.map((r) => r.lean))
  const maxLeg = Math.max(...slideRows.map((r) => r.leg))
  check('Rutschen: B rutscht', ownView.sliding)
  check('Rutsch-Pose bei A: zurückgelehnt, Beine vorn', maxLean > 0.2 && maxLeg > 1, `Neigung ${maxLean.toFixed(2)}, Bein ${maxLeg.toFixed(2)} rad`)
  check('Rutsch-Sicht: weiteres Sichtfeld', ownView.maxAmount > 0.8 && ownView.maxFov > 80, `FOV bis ${ownView.maxFov.toFixed(1)}`)
  check('nach dem Rutschen: Sichtfeld zurück, Kamera nicht gekippt', ownView.fovAfter === 75 && Math.abs(ownView.rollAfter) < 1e-6, `FOV ${ownView.fovAfter}, Neigung ${ownView.rollAfter}`)
  const backToStand = await avatarOfB()
  check('Pose danach wieder aufrecht', Math.abs(backToStand.upperBodyY) < 0.01)
  await wait(500)

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
