// Helfer für die Browser-Tests: startet Vite + Spielserver auf eigenen Ports,
// Spielzustand über window.__dusk (nur im Dev-Build).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const VITE_PORT = 5199
export const SERVER_PORT = 8099
export const SERVER_URL = `ws://localhost:${SERVER_PORT}`
export const GAME_URL = `http://localhost:${VITE_PORT}/3D-basics/`

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // noch nicht bereit
    }
    await wait(250)
  }
  throw new Error(`${url} nicht erreichbar`)
}

// serverEnv z.B. { KILLS_TO_WIN: '2', SIMULATED_LATENCY_MS: '150' }
export async function startServers({ gameServer = true, serverEnv = {} } = {}) {
  const children = []
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  children.push(vite)
  if (gameServer) {
    const server = spawn('node', ['server/index.ts'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(SERVER_PORT), ...serverEnv },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    server.log = ''
    server.stdout.on('data', (chunk) => (server.log += chunk))
    children.push(server)
  }
  await waitForHttp(GAME_URL)
  if (gameServer) await waitForHttp(`http://localhost:${SERVER_PORT}`)
  return {
    serverLog: () => children[1]?.log ?? '',
    stop: () => children.forEach((child) => child.kill()),
  }
}

// Weicht auf einen vorhandenen Chromium aus, falls der Playwright-Browser fehlt
export async function launchBrowser() {
  const args = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  try {
    return await chromium.launch({ args })
  } catch (error) {
    const fallback = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
    if (!existsSync(fallback)) throw error
    return chromium.launch({ args, executablePath: fallback })
  }
}

// online=false -> Singleplayer (zeigt auf einen Port ohne Server)
export async function openGame(browser, { online = true, name, errors = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } })
  page.on('pageerror', (error) => errors.push(error.message))
  if (name) {
    await page.addInitScript((n) => {
      try {
        localStorage.setItem('duskArena.name', n)
      } catch {
        // egal
      }
    }, name)
  }
  const server = online ? SERVER_URL : 'ws://localhost:1'
  await page.goto(`${GAME_URL}?server=${encodeURIComponent(server)}`)
  await page.waitForFunction(() => 'undefined' !== typeof window.__dusk)
  return page
}

// Klick auf "Spielen" (in eine Ecke, nicht ins Namensfeld)
export async function play(page) {
  await page.click('#overlay', { position: { x: 5, y: 5 } })
}

// Zielen + Schuss im selben Aufruf: LookControl setzt die Kamera bei jedem
// (headless auch synthetischen) Mausereignis zurück. Feuerpause/Magazin
// zurückgesetzt, damit Tests nicht von der Bildrate abhängen.
export async function shootAt(page, target) {
  await page.evaluate(([x, y, z]) => {
    __dusk.camera.lookAt(x, y, z)
    __dusk.lookControl.euler.setFromQuaternion(__dusk.camera.quaternion)
    __dusk.weapon.cooldownRemaining = 0
    __dusk.weapon.reloadRemaining = 0
    __dusk.weapon.ammo = 12
    __dusk.weapon.tryShoot()
  }, target)
}

export async function teleport(page, x, y, z) {
  await page.evaluate(
    ([x, y, z]) => __dusk.player.spawn({ x, y, z, clone() { return this } }),
    [x, y, z]
  )
}

// Exit-Code 1 bei Fehlschlag
export function createChecks() {
  let failed = 0
  return {
    check(label, ok, detail = '') {
      if (!ok) failed++
      console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`)
    },
    finish() {
      console.log(failed === 0 ? '\nAlle Prüfungen bestanden' : `\n${failed} Prüfung(en) fehlgeschlagen`)
      process.exitCode = failed === 0 ? 0 : 1
    },
  }
}
