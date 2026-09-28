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
      style.textContent = '#score-goal.hidden, #connection-warning.hidden, #spawn-protection.hidden { display: block !important; }'
      document.head.append(style)
      document.querySelector('#score-goal').textContent = 'Erstes Team mit 20 Kills gewinnt'
      const feed = document.querySelector('#kill-feed')
      for (const t of ['Maximilianus1234 ✕ Clara', 'Du ✕ Ben', 'Ben ✕ Du']) { const e = document.createElement('div'); e.className = 'kill-entry'; e.textContent = t; feed.append(e) }
      const ids = ['#scoreboard', '#score-goal', '#net-status', '#kill-feed', '#connection-warning', '#health-hud', '#weapon-hud', '#jump-button', '#shoot-button', '#reload-button', '#crouch-button', '#switch-button']
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
    await context.close()
  }
} finally {
  await browser.close()
  servers.stop()
  finish()
}
