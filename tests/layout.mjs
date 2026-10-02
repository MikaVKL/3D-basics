// Layout: HUD-Elemente überlappen sich in keiner Bildschirmgröße (online,
// mit langem Status und Kill-Feed), Handy hochkant zeigt "Gerät drehen".
//
//   node tests/layout.mjs
import { launchBrowser, startServers, wait, GAME_URL, play, createChecks } from './lib.mjs'

const { check, finish } = createChecks()
const servers = await startServers()
import { SERVER_URL } from './lib.mjs'
const browser = await launchBrowser()
const sizes = [['Rechner schmal', 700, 800, false], ['Rechner', 1280, 720, false], ['Laptop', 900, 500, false], ['Tablet', 1024, 768, true], ['Handy quer', 844, 390, true], ['Handy klein quer', 667, 375, true], ['Handy hoch', 390, 844, true]]
try {
  for (const [name, width, height, touch] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch })
    const page = await context.newPage()
    await page.addInitScript(() => localStorage.setItem('duskArena.name', 'Maximilianus1234'))
    await page.goto(`${GAME_URL}?server=${encodeURIComponent(SERVER_URL)}`)
    await page.waitForFunction(() => typeof window.__dusk !== 'undefined')
    if (width < height && touch) {
      const hint = await page.evaluate(() => getComputedStyle(document.querySelector('#rotate-hint')).display)
      check(`${name}: Hinweis "Gerät drehen"`, hint === 'flex')
      await context.close()
      continue
    }
    if (touch) await page.tap('#overlay', { position: { x: 5, y: 5 } }); else await play(page)
    await wait(2500)
    const result = await page.evaluate(() => {
      const style = document.createElement('style')
      // Warnung ohne !important: der Hinweis hat im Spiel Vorrang (teilen sich den Platz)
      style.textContent = '#score-goal.hidden, #spawn-protection.hidden, #notice-banner.hidden { display: block !important; } body #connection-warning.hidden { display: block; }'
      document.querySelector('#notice-banner').textContent = 'Verbindung zum Server verloren – Singleplayer, verbinde neu …'
      document.head.append(style)
      document.querySelector('#score-goal').textContent = 'Erstes Team mit 20 Kills gewinnt'
      const feed = document.querySelector('#kill-feed')
      for (const t of ['Maximilianus1234 ✕ Clara', 'Du ✕ Ben', 'Ben ✕ Du']) { const e = document.createElement('div'); e.className = 'kill-entry'; e.textContent = t; feed.append(e) }
      const ids = ['#scoreboard', '#score-goal', '#net-status', '#kill-feed', '#connection-warning', '#notice-banner', '#minimap', '#health-hud', '#weapon-hud', '#jump-button', '#shoot-button', '#reload-button', '#crouch-button', '#switch-button', '#aim-button', '#menu-button']
      const boxes = ids.map((id) => [id, document.querySelector(id)?.getBoundingClientRect()]).filter(([, r]) => r && r.width > 0)
        .filter(([id]) => { let e = document.querySelector(id); while (e) { if (getComputedStyle(e).display === 'none') return false; e = e.parentElement } return true })
      const overlaps = []
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, ra] = boxes[i], [b, rb] = boxes[j]
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        if (w > 1 && h > 1) overlaps.push(`${a}/${b}`)
      }
      const offscreen = boxes.filter(([, r]) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight).map(([id]) => id)
      return { overlaps, offscreen }
    })
    check(`${name} (${width}x${height}): keine Überlappungen`, result.overlaps.length === 0, result.overlaps.join(', '))
    check(`${name}: alles im Bild`, result.offscreen.length === 0, result.offscreen.join(', '))

    // Rundenende: Banner mit Statistik von 8 Spielern (Hinweise sind dann weg)
    const roundResult = await page.evaluate(async () => {
      const mod = await import('/3D-basics/src/roundStats.ts')
      const stats = [
        ['Anna', 'red', 14, 6, 5], ['Maximilianus1234', 'blue', 9, 8, 2], ['Clara', 'red', 7, 9, 1], ['Dora', 'blue', 6, 10, 0],
        ['Emil', 'red', 4, 10, 2], ['Finn', 'blue', 3, 11, 0], ['Gina', 'red', 2, 12, 1], ['Hugo', 'blue', 0, 13, 0],
      ].map(([name, team, kills, deaths, headshots], id) => ({ id: id + 1, name, team, kills, deaths, headshots }))
      for (const id of ['#notice-banner', '#connection-warning', '#score-goal']) document.querySelector(id).style.display = 'none'
      document.querySelector('#round-banner').className = 'red'
      document.querySelector('#round-winner').textContent = 'Team Rot gewinnt!'
      document.querySelector('#round-countdown').textContent = 'Nächste Runde in 8s'
      mod.renderRoundStats(document.querySelector('#round-stats'), stats, 8)
      const ids = ['#round-banner', '#scoreboard', '#net-status', '#kill-feed', '#minimap', '#health-hud', '#weapon-hud', '#jump-button', '#shoot-button', '#reload-button', '#crouch-button', '#switch-button', '#aim-button', '#menu-button']
      const boxes = ids.map((id) => [id, document.querySelector(id)?.getBoundingClientRect()]).filter(([, r]) => r && r.width > 0)
        .filter(([id]) => { let e = document.querySelector(id); while (e) { if (getComputedStyle(e).display === 'none') return false; e = e.parentElement } return true })
      const overlaps = []
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, ra] = boxes[i], [b, rb] = boxes[j]
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        if (w > 1 && h > 1) overlaps.push(`${a}/${b}`)
      }
      const banner = boxes.find(([id]) => id === '#round-banner')?.[1]
      const own = document.querySelector('#round-stats .own')
      return { overlaps, inside: !!banner && banner.left >= 0 && banner.top >= 0 && banner.right <= innerWidth && banner.bottom <= innerHeight, ownShown: !!own }
    })
    check(`${name}: Rundenende-Statistik ohne Überlappung`, roundResult.overlaps.length === 0, roundResult.overlaps.join(', '))
    check(`${name}: Rundenende-Statistik im Bild, eigene Zeile sichtbar`, roundResult.inside && roundResult.ownShown)

    // Normalfall: keine Banner, Kill-Feed sichtbar (die Banner blenden ihn aus)
    const normal = await page.evaluate(() => {
      document.querySelector('#round-banner').classList.add('hidden')
      document.querySelector('#notice-banner').classList.add('hidden')
      document.querySelector('#notice-banner').style.display = 'none'
      document.querySelector('#score-goal').style.display = 'block'
      const ids = ['#scoreboard', '#score-goal', '#net-status', '#minimap', '#kill-feed', '#health-hud', '#weapon-hud', '#jump-button', '#shoot-button', '#reload-button', '#crouch-button', '#switch-button', '#aim-button', '#menu-button']
      const measure = () => {
        const boxes = ids.map((id) => [id, document.querySelector(id)?.getBoundingClientRect()]).filter(([, r]) => r && r.width > 0)
          .filter(([id]) => { let e = document.querySelector(id); while (e) { if (getComputedStyle(e).display === 'none') return false; e = e.parentElement } return true })
        const overlaps = []
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const [a, ra] = boxes[i], [b, rb] = boxes[j]
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
          if (w > 1 && h > 1) overlaps.push(`${a}/${b}`)
        }
        return { overlaps, feedShown: boxes.some(([id]) => id === '#kill-feed'), mapShown: boxes.some(([id]) => id === '#minimap') }
      }
      const withMap = measure()
      __dusk.minimap.setVisible(false) // Karte aus: Feed rückt nach oben
      const withoutMap = measure()
      __dusk.minimap.setVisible(true)
      return { withMap, withoutMap }
    })
    check(`${name}: Minimap + Kill-Feed ohne Überlappung`, normal.withMap.overlaps.length === 0 && normal.withMap.feedShown && normal.withMap.mapShown, `${normal.withMap.overlaps.join(', ')} (Feed ${normal.withMap.feedShown}, Karte ${normal.withMap.mapShown})`)
    check(`${name}: ohne Minimap ohne Überlappung`, normal.withoutMap.overlaps.length === 0 && normal.withoutMap.feedShown && !normal.withoutMap.mapShown, `${normal.withoutMap.overlaps.join(', ')} (Feed ${normal.withoutMap.feedShown}, Karte ${normal.withoutMap.mapShown})`)
    await context.close()
  }
} finally {
  await browser.close()
  servers.stop()
  finish()
}
