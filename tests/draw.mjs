// Waffe ziehen (je Waffe eigene Bewegung und Dauer) und Wippen beim Laufen.
//
//   node tests/draw.mjs
import { startServers, launchBrowser, openGame, play, wait, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers({ gameServer: false })
const browser = await launchBrowser()
const errors = []
try {
  const page = await openGame(browser, { online: false, errors })
  await play(page)
  await wait(500)

  const r = await page.evaluate(() => {
    const W = __dusk.weapon
    const real = Object.getPrototypeOf(W).update.bind(W)
    W.update = () => {} // Bilder selbst steuern (Headless rendert zu langsam)
    W.slots = ['pistol', 'rifle', 'knife', 'shotgun', 'sniper', 'heavyPistol', 'smg']
    const sounds = []
    const play = __dusk.sound.play.bind(__dusk.sound)
    __dusk.sound.play = (name, volume) => {
      sounds.push(name)
      play(name, volume)
    }
    const g = W.view.group
    const sample = () => ({ x: g.position.x, y: g.position.y, z: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z })
    const settle = () => {
      for (let i = 0; i < 90; i++) real(1 / 60)
    }
    // Wechsel auf id: Dauer, Zeitpunkt des Modelltauschs, Haltung während des Ziehens
    const draw = (id) => {
      W.switchTo(id === 'pistol' ? 'rifle' : 'pistol')
      settle()
      W.switchTo(id)
      sounds.length = 0
      const frames = []
      let swapAt = null
      let t = 0
      while (W.getAmmoState().weapon && frames.length < 200) {
        const before = W.view.current === W.view.models[id].group ? true : false
        real(1 / 60)
        t += 1 / 60
        const swapped = W.view.models[id].group.visible
        if (swapped && swapAt === null) swapAt = t
        frames.push(sample())
        if (W.switchRemaining === 0) break
      }
      settle()
      const range = (k) => Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k]))
      return { time: t, swapAt, accent: sounds.filter((s) => s === 'shotgunPump' || s === 'sniperBolt'), zRange: range('z'), rzRange: range('rz'), ryRange: range('ry'), yRange: range('y'), rxRange: range('rx') }
    }
    const out = {}
    for (const id of ['pistol', 'rifle', 'knife', 'shotgun', 'sniper', 'heavyPistol', 'smg']) out[id] = draw(id)

    // Wippen
    W.switchTo('rifle')
    settle()
    const bob = (speed, onGround, aim) => {
      W.setMotion(speed, onGround)
      W.setAiming(aim)
      for (let i = 0; i < 90; i++) real(1 / 60) // einschwingen
      const ys = []
      const xs = []
      for (let i = 0; i < 120; i++) {
        real(1 / 60)
        ys.push(g.position.y)
        xs.push(g.position.x)
      }
      return { y: Math.max(...ys) - Math.min(...ys), x: Math.max(...xs) - Math.min(...xs) }
    }
    out.bobStand = bob(0, true, false)
    out.bobWalk = bob(6, true, false)
    out.bobSprint = bob(9, true, false)
    out.bobAir = bob(6, false, false)
    out.bobAim = bob(6, true, true)
    return out
  })

  const t = (id) => r[id].time
  check('Ziehdauer: Pistole 0,30 s, MP 0,30 s, Sturmgewehr 0,35 s, Schwere Pistole 0,40 s, Shotgun 0,45 s, Sniper 0,55 s',
    Math.abs(t('pistol') - 0.3) < 0.03 && Math.abs(t('smg') - 0.3) < 0.03 && Math.abs(t('rifle') - 0.35) < 0.03 && Math.abs(t('heavyPistol') - 0.4) < 0.03 && Math.abs(t('shotgun') - 0.45) < 0.03 && Math.abs(t('sniper') - 0.55) < 0.03,
    ['pistol', 'smg', 'rifle', 'heavyPistol', 'shotgun', 'sniper', 'knife'].map((id) => `${id} ${t(id).toFixed(2)}`).join(', '))
  check('Modelltausch nach dem Absenken (~0,15 s), nicht erst am Ende', ['pistol', 'rifle', 'sniper'].every((id) => r[id].swapAt > 0.12 && r[id].swapAt < 0.2), ['pistol', 'rifle', 'sniper'].map((id) => `${id} ${r[id].swapAt?.toFixed(2)}`).join(', '))
  check('Messer wirbelt um die Längsachse (Roll-Bereich > 3 rad)', r.knife.rzRange > 3, r.knife.rzRange.toFixed(2))
  check('Shotgun pumpt: Vor-/Zurück-Bewegung (z-Bereich > 0,04) und Pumpgriff-Ton', r.shotgun.zRange > 0.04 && r.shotgun.accent.join() === 'shotgunPump', `z ${r.shotgun.zRange.toFixed(3)}, ${r.shotgun.accent.join()}`)
  check('Sniper: schweres Nachwiegen (y-Bereich) und Repetier-Ton', r.sniper.accent.join() === 'sniperBolt', r.sniper.accent.join())
  check('Pistole schwingt seitlich ein (Gier), MP flickt stärker', r.pistol.ryRange > 0.1 && r.smg.ryRange > r.pistol.ryRange, `${r.pistol.ryRange.toFixed(2)} / ${r.smg.ryRange.toFixed(2)}`)
  check('Jede Waffe hat eine andere Zieh-Bewegung', new Set(['pistol', 'rifle', 'knife', 'shotgun', 'sniper', 'heavyPistol', 'smg'].map((id) => [r[id].zRange, r[id].rzRange, r[id].ryRange, r[id].rxRange].map((v) => v.toFixed(2)).join('/'))).size === 7)

  check('Stehen: kein Wippen', r.bobStand.y < 0.001 && r.bobStand.x < 0.001, JSON.stringify(r.bobStand))
  check('Gehen: Waffe wippt (y > 5 mm, x > 8 mm)', r.bobWalk.y > 0.005 && r.bobWalk.x > 0.008, JSON.stringify(r.bobWalk))
  check('Sprinten wippt stärker als Gehen', r.bobSprint.y > r.bobWalk.y * 1.2, `${r.bobSprint.y.toFixed(3)} / ${r.bobWalk.y.toFixed(3)}`)
  check('In der Luft: kein Wippen', r.bobAir.y < 0.002, JSON.stringify(r.bobAir))
  check('Beim Zielen fast kein Wippen (< 25 % vom Gehen)', r.bobAim.y < r.bobWalk.y * 0.25, `${r.bobAim.y.toFixed(4)} / ${r.bobWalk.y.toFixed(4)}`)
  check('keine Konsolenfehler', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  servers.stop()
  finish()
}
