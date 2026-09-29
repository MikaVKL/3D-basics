// Vorschau der Figur-Varianten (Abstimmung): node tests/_avatar-variants.mjs <ordner>
import { launchBrowser, openGame, play, startServers, teleport, wait } from './lib.mjs'
const out = process.argv[2] ?? '.'
const servers = await startServers()
const browser = await launchBrowser()
try {
  const A = await openGame(browser, { name: 'Anna' })
  await A.setViewportSize({ width: 1100, height: 520 })
  await play(A); await wait(2500)
  await teleport(A, -6, 1.7, 14)
  for (const view of ['front', 'side', 'back']) {
    await A.evaluate(async (view) => {
      const { PlayerAvatar } = await import('/3D-basics/src/playerAvatar.ts')
      const scene = __dusk.camera.parent
      for (const o of [...scene.children]) if (o.userData.preview) scene.remove(o)
      const yaw = { front: 0, side: Math.PI / 2, back: Math.PI }[view]
      const rows = [['red', 0], ['blue', 0], ['red', 1], ['blue', 1], ['red', 2], ['blue', 2], ['red', 3], ['blue', 3]]
      rows.forEach(([team, variant], i) => {
        const avatar = new PlayerAvatar(team, variant)
        avatar.root.userData.preview = true
        avatar.root.position.set(-6 + (i - 3.5) * 1.1, 0, 10)
        avatar.root.rotation.y = Math.PI + yaw
        if (variant === 3 && i % 2 === 1) avatar.setWeapon('rifle')
        avatar.setTeam(team)
        scene.add(avatar.root)
      })
      __dusk.camera.position.set(-6, 1.5, 15)
      __dusk.camera.lookAt(-6, 1.2, 10)
      __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    }, view)
    await wait(500)
    await A.screenshot({ path: `${out}/varianten-${view}.png` })
  }
} finally { await browser.close(); servers.stop() }
