// Waffen: Wechsel (Tasten, Mausrad, Q), Munition je Waffe, Nachladezeiten,
// Dauerfeuer, Streuung, Lauftempo, Respawn-Ausrüstung und Server-Schaden
// samt Feuerraten-Begrenzung.
//
//   node tests/weapons.mjs
import { startServers, launchBrowser, openGame, play, shootAt, teleport, wait, createChecks, killFeedText } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
const browser = await launchBrowser()
const errors = []

const hud = (page) =>
  page.evaluate(() => ({
    weapon: __dusk.weapon.current,
    playerWeapon: __dusk.player.weapon,
    // Aktives Feld der Waffenleiste + Name im Waffenfeld
    slot: `${document.querySelector('#weapon-slots .active')?.textContent} ${document.querySelector('#weapon-name').textContent}`,
    icon: document.querySelector('#weapon-current-icon .weapon-icon')?.dataset.weapon,
    ammo: document.querySelector('#ammo-hud').textContent,
  }))

try {
  // --- Singleplayer ---
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)
  let h = await hud(page)
  check('Start mit Pistole', h.weapon === 'pistol' && h.slot === '1 Pistole' && h.icon === 'pistol' && h.ammo === '12 / 12', JSON.stringify(h))

  await page.keyboard.press('Digit2')
  const duringSwitch = await page.evaluate(() => __dusk.weapon.tryShoot())
  await wait(500)
  h = await hud(page)
  check('Taste 2: Sturmgewehr', h.weapon === 'rifle' && h.playerWeapon === 'rifle' && h.slot === '2 Sturmgewehr' && h.icon === 'rifle' && h.ammo === '30 / 30', JSON.stringify(h))
  check('während des Wechsels kein Schuss', duringSwitch === false)

  await page.keyboard.press('KeyQ')
  await wait(400)
  check('Q: zurück zur Pistole', (await hud(page)).weapon === 'pistol')
  await page.mouse.wheel(0, 100)
  await wait(400)
  check('Mausrad: nächste Waffe', (await hud(page)).weapon === 'rifle')
  await page.keyboard.press('Digit1')
  await wait(400)

  // Munition bleibt pro Waffe erhalten
  await teleport(page, 0, 1.7, 12)
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      __dusk.weapon.cooldownRemaining = 0
      __dusk.weapon.tryShoot()
    }
    __dusk.weapon.switchTo('rifle')
    __dusk.weapon.switchRemaining = 0
    __dusk.weapon.switchTo('pistol')
    __dusk.weapon.switchRemaining = 0
  })
  check('Munition je Waffe bleibt erhalten', (await hud(page)).ammo === '9 / 12')

  // Nachladezeiten direkt über update() (Headless-FPS zu ungenau)
  const reloads = await page.evaluate(() => {
    const W = __dusk.weapon
    const result = {}
    W.reload()
    W.update(1.1)
    result.pistolAt11 = W.ammo
    W.update(0.15)
    result.pistolAt125 = W.ammo
    W.switchTo('rifle')
    W.switchRemaining = 0
    W.ammo = 5
    W.reload()
    W.update(1.9)
    result.rifleAt19 = W.ammo
    W.update(0.15)
    result.rifleAt205 = W.ammo
    W.ammo = 5
    W.reload()
    W.update(0.5)
    W.switchTo('pistol')
    W.update(2)
    W.switchTo('rifle')
    W.switchRemaining = 0
    result.rifleAfterCancel = W.ammo
    return result
  })
  check('Pistole lädt in 1,2 s nach', reloads.pistolAt11 === 9 && reloads.pistolAt125 === 12, JSON.stringify(reloads))
  check('Sturmgewehr lädt in 2 s nach', reloads.rifleAt19 === 5 && reloads.rifleAt205 === 30)
  check('Wechsel bricht Nachladen ab', reloads.rifleAfterCancel === 5)

  // Dauerfeuer: echte Frames (über Nachholen unabhängig von den FPS)
  const burst = await page.evaluate(async () => {
    const W = __dusk.weapon
    W.ammo = 30
    // Bildrate mitmessen: unter ~4 FPS holt das Nachholen nicht alle Schüsse auf
    const start = performance.now()
    let frames = 0
    const countFrame = () => {
      frames++
      if (performance.now() - start < 1000) requestAnimationFrame(countFrame)
    }
    requestAnimationFrame(countFrame)
    W.setTrigger(true)
    await new Promise((r) => setTimeout(r, 1000))
    W.setTrigger(false)
    const fps = (frames * 1000) / (performance.now() - start)
    const rifleShots = 30 - W.ammo
    W.switchTo('pistol')
    W.switchRemaining = 0
    W.ammo = 12
    W.setTrigger(true)
    await new Promise((r) => setTimeout(r, 600))
    W.setTrigger(false)
    return { rifleShots, fps, pistolShots: 12 - W.ammo }
  })
  // Pro Bild höchstens 2 Schuss (Nachhol-Grenze 0,1 s)
  const minShots = Math.min(9, Math.floor(burst.fps * 2))
  check('Sturmgewehr: ~10 Schuss/s bei gehaltener Taste', burst.rifleShots >= minShots && burst.rifleShots <= 12, `${burst.rifleShots} Schuss bei ${burst.fps.toFixed(0)} FPS`)
  check('Pistole: gehaltene Taste = ein Schuss', burst.pistolShots === 1, `${burst.pistolShots} Schuss`)

  // Streuung: 15 Schüsse ohne Pause an die Wand, Winkel zur Blickrichtung
  const spread = await page.evaluate(() => {
    const W = __dusk.weapon
    W.switchTo('rifle')
    W.switchRemaining = 0
    W.heat = 0
    const eye = __dusk.camera.position.clone()
    const forward = __dusk.camera.getWorldDirection(new eye.constructor())
    const angles = []
    const original = W.onShot
    W.onShot = (from, to, hit) => {
      angles.push(to.clone().sub(eye).normalize().angleTo(forward))
      original(from, to, hit)
    }
    for (let i = 0; i < 15; i++) {
      W.cooldownRemaining = 0
      W.ammo = 30
      W.tryShoot()
    }
    W.onShot = original
    return angles
  })
  const first = Math.max(...spread.slice(0, 3))
  const later = Math.max(...spread.slice(8))
  check('erste Schüsse der Salve genau', first < 0.001, `${first.toFixed(4)} rad`)
  check('Dauerfeuer streut, begrenzt', later > 0.01 && Math.max(...spread) <= 0.0351, `bis ${Math.max(...spread).toFixed(4)} rad`)

  // Lauftempo über Physik-Simulation
  const distance = (weaponId) =>
    page.evaluate((id) => {
      const P = __dusk.player
      P.spawn({ x: 0, y: 1.7, z: 12, clone() { return this } })
      __dusk.camera.lookAt(0, 1.7, 0)
      P.weapon = id
      P.setMoveInput(0, 1)
      for (let i = 0; i < 30; i++) P.update(1 / 60)
      P.setMoveInput(0, 0)
      return 12 - __dusk.camera.position.z
    }, weaponId)
  const pistolDistance = await distance('pistol')
  const rifleDistance = await distance('rifle')
  await page.evaluate(() => (__dusk.player.weapon = __dusk.weapon.current))
  const ratio = rifleDistance / pistolDistance
  check('Sturmgewehr läuft 92 % so schnell', Math.abs(ratio - 0.92) < 0.01, ratio.toFixed(3))

  // Messer: Taste 3, keine Munition, Reichweite ~2,5 m, schneller
  await page.keyboard.press('Digit3')
  await wait(500)
  h = await hud(page)
  check('Taste 3: Messer', h.weapon === 'knife' && h.slot === '3 Messer' && h.icon === 'knife' && h.ammo === '—', JSON.stringify(h))
  const knifeRatio = (await distance('knife')) / pistolDistance
  await page.evaluate(() => (__dusk.player.weapon = __dusk.weapon.current))
  check('Messer läuft 115 % so schnell', Math.abs(knifeRatio - 1.15) < 0.01, knifeRatio.toFixed(3))
  await page.evaluate(() => {
    window.__stabs = []
    __dusk.weapon.onEnemyHit = (kill, point, damage) => window.__stabs.push(damage)
    window.__swings = 0
    __dusk.weapon.onSwing = () => window.__swings++
  })
  // Dummy bei (3, 0.8, -6)
  await teleport(page, 3, 1.7, -2)
  await wait(200)
  await shootAt(page, [3, 0.8, -6])
  await wait(400) // Trefferfenster des Stichs (0,2 s) abwarten
  await teleport(page, 3, 1.7, -4)
  await wait(200)
  await shootAt(page, [3, 0.8, -6])
  const stabs = await page.evaluate(() => ({ hits: window.__stabs, swings: window.__swings, tracers: __dusk.weapon.tracers.length }))
  check('Messer: 4 m daneben, 2 m trifft mit 50', stabs.hits.join() === '50' && stabs.swings === 2, JSON.stringify(stabs))
  check('Messer: keine Leuchtspur', stabs.tracers === 0)

  // Zielhilfe und Trefferfenster: Stich trifft auch knapp daneben, und wenn der
  // Gegner erst kurz nach dem Klick in Reichweite kommt (Handy: kein perfektes Timing)
  const stabTest = (script) =>
    page.evaluate((code) => {
      const t = __dusk.arena.shootables.find((m) => m.userData.damageable && m.position.x === 3 && m.position.z === -6)
      const reset = () => {
        const d = t.userData.damageable
        d.vitals = { health: 100, shield: 25, shieldRegenCooldown: 0 }
        d.respawnRemaining = 0
        t.visible = true
      }
      const aim = (x, y, z) => {
        __dusk.camera.lookAt(x, y, z)
        __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
      }
      window.__stabs = []
      return new Function('P', 'W', 'reset', 'aim', code)(__dusk.player, __dusk.weapon, reset, aim)
    }, script)
  const side = await stabTest(`
    const out = []
    for (const dx of [0.5, 0.7, 1.2]) {
      reset(); P.spawn({ x: 3, y: 1.7, z: -4, clone() { return this } })
      aim(3 + dx, 0.8, -6); W.cooldownRemaining = 0; W.tryShoot(); out.push(window.__stabs.length)
      window.__stabs.length = 0
    }
    return out`)
  check('Messer: 0,5 m und 0,7 m neben dem Fadenkreuz (2 m) treffen, 1,2 m nicht', side.join() === '1,1,0', side.join())
  const late = await stabTest(`
    reset(); P.spawn({ x: 3, y: 1.7, z: 0, clone() { return this } })
    aim(3, 0.8, -6); W.cooldownRemaining = 0; W.tryShoot() // Gegner 6 m weg: kein Treffer im Klick
    const atClick = window.__stabs.length
    P.spawn({ x: 3, y: 1.7, z: -4, clone() { return this } }) // kommt in Reichweite
    aim(3, 0.8, -6); W.update(0.1)
    return [atClick, window.__stabs.length]`)
  check('Messer: Gegner kommt 0,1 s nach dem Klick in Reichweite - Treffer', late.join() === '0,1', late.join())
  const tooLate = await stabTest(`
    reset(); P.spawn({ x: 3, y: 1.7, z: 0, clone() { return this } })
    aim(3, 0.8, -6); W.cooldownRemaining = 0; W.tryShoot()
    W.update(0.3) // Fenster (0,2 s) vorbei
    P.spawn({ x: 3, y: 1.7, z: -4, clone() { return this } })
    aim(3, 0.8, -6); W.update(0.05)
    return window.__stabs.length`)
  check('Messer: nach Ablauf des Fensters (0,3 s) kein nachträglicher Treffer', tooLate === 0, String(tooLate))

  // Respawn: Startwaffe, volle Magazine
  await page.evaluate(() => {
    __dusk.weapon.switchTo('rifle')
    __dusk.weapon.ammo = 3
    __dusk.player.takeDamage(999)
  })
  await wait(3600)
  const respawned = await page.evaluate(() => ({
    alive: __dusk.player.isAlive,
    weapon: __dusk.weapon.current,
    rifleAmmo: __dusk.weapon.ammoByWeapon.rifle,
  }))
  check('nach Respawn: Pistole, volle Magazine', respawned.alive && respawned.weapon === 'pistol' && respawned.rifleAmmo === 30, JSON.stringify(respawned))

  // --- Mehrspieler: Schaden rechnet der Server nach der gehaltenen Waffe ---
  const A = await openGame(browser, { name: 'Anna', errors })
  const B = await openGame(browser, { name: 'Ben', errors })
  await play(A)
  await play(B)
  await wait(3800)
  const vitals = () => B.evaluate(() => ({ ...__dusk.player.vitals }))
  const aId = await A.evaluate(() => __dusk.network.localId)
  const heldByA = () => B.evaluate((id) => __dusk.remotePlayers.players.get(id).avatar.heldWeapon, aId)
  // B protokolliert räumliche Töne
  await B.evaluate(() => {
    window.__sounds = []
    const playAt = __dusk.sound.playAt.bind(__dusk.sound)
    __dusk.sound.playAt = (name, position, volume) => {
      window.__sounds.push(name)
      playAt(name, position, volume)
    }
  })
  const takeSounds = () => B.evaluate(() => window.__sounds.splice(0).filter((s) => s !== 'step').join())
  await teleport(B, 0, 1.7, 5)
  await teleport(A, 0, 1.7, 10)
  check('B sieht A mit Pistole', (await heldByA()) === 'pistol')
  await A.keyboard.press('Digit2')
  await wait(700)
  check('B sieht A mit Sturmgewehr', (await heldByA()) === 'rifle')
  await takeSounds()
  await shootAt(A, [0, 0.9, 5])
  await wait(300)
  await shootAt(A, [0, 1.7, 5])
  await wait(500)
  const afterRifle = await vitals()
  check('B hört Gewehr-Schüsse', (await takeSounds()) === 'rifleShot,rifleShot')
  // 12 + 24 = 36: Schild 25 weg, 11 aufs Leben
  check('Sturmgewehr: 12 Körper + 24 Kopf', afterRifle.shield === 0 && afterRifle.health === 89, JSON.stringify(afterRifle))

  // Manipulierter Client: 10 Treffermeldungen auf einmal
  await A.keyboard.press('Digit1')
  await wait(1200)
  await A.evaluate(() => {
    const id = [...__dusk.network.remotePlayers][0]
    for (let i = 0; i < 10; i++) __dusk.network.sendHit(id, false)
  })
  await wait(500)
  const afterSpam = await vitals()
  check('Server begrenzt Trefferflut (3 x 20)', afterSpam.health === 29, JSON.stringify(afterSpam))

  // Messer: gefälschter Stich aus 5 m zählt nicht, echter aus 2 m tötet (50 > 29)
  await A.keyboard.press('Digit3')
  await wait(600)
  check('B sieht A mit Messer', (await heldByA()) === 'knife')
  await A.evaluate(() => __dusk.network.sendHit([...__dusk.network.remotePlayers][0], false))
  await wait(400)
  check('Server lehnt Messer aus 5 m ab', (await vitals()).health === 29)
  await teleport(A, 0, 1.7, 7)
  await wait(400)
  await shootAt(A, [0, 0.9, 5])
  await wait(500)
  check('Messerstich aus 2 m tötet', !(await B.evaluate(() => __dusk.player.isAlive)))
  check('B hört den Stich', (await takeSounds()) === 'knife')
  const feeds = [await killFeedText(A), await killFeedText(B)]
  check('Kill-Feed zeigt Messer-Symbol', feeds[0] === 'Du [knife] Ben' && feeds[1] === 'Anna [knife] Du', feeds.join(' / '))
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
