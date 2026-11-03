import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

import { readOrCreateToken } from '../../../bridge/src/home.ts'
import { nativeManifest, writeHostScript } from '../../../bridge/src/native.ts'

const ROOT = join(import.meta.dirname, '../../../..')
export const EXTENSION = join(ROOT, 'packages/extension/.output')
const CLI = join(ROOT, 'packages/bridge/src/cli.ts')

// the token and the channels of the tests' bridges, never the user's
process.env.REDLINE_HOME = mkdtempSync(join(tmpdir(), 'redline-e2e-home-'))
// nor their Herdr: a wait run in its pane would name the agent there after the tests' channel
delete process.env.HERDR_PANE_ID

export function token(): Promise<string> {
  return readOrCreateToken()
}

// Chromium's user data directory, with the native host in it: the extension pairs by itself
export async function chromiumUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'redline-e2e-chromium-'))
  await mkdir(join(dir, 'NativeMessagingHosts'))
  const manifest = nativeManifest('chrome', await writeHostScript(CLI))
  await writeFile(join(dir, 'NativeMessagingHosts', 'redline_bridge.json'), JSON.stringify(manifest))
  return dir
}

// e2e-fixtures/, on a free port of the loopback
export async function serveFixtures(): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer(async (req, res) => {
    const name = (new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/+/, '') || 'test-page.html').replace(/\.\./g, '')
    // the repository's Preact too, for preact-page.html
    const file = name.startsWith('node_modules/preact/') ? join(ROOT, name) : join(ROOT, 'e2e-fixtures', name)
    const body = await readFile(file).catch(() => undefined)
    const type = /\.m?js$/.test(name) ? 'text/javascript' : 'text/html; charset=utf-8'
    if (body) res.writeHead(200, { 'content-type': type }).end(body)
    else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() }
}

export interface Bridge {
  dir: string
  // its channel, as it says
  channel: string
  // its output, once it exits
  done: Promise<{ code: number | null; stdout: string }>
  process: ChildProcess
}

// `redline wait`, from the sources, on the extension's port; its project is the directory it runs in
export async function startBridge(previewUrl: string, extra: string[] = [], cwd?: string): Promise<Bridge> {
  const dir = await mkdtemp(join(tmpdir(), 'redline-e2e-'))
  // named as the sidebar shows it, which the tests look for
  const child = spawn(process.execPath, [CLI, 'wait', '--agent', 'Claude', '--url', previewUrl, '--dir', dir, ...extra], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
  const done = new Promise<{ code: number | null; stdout: string }>((resolve) => child.on('exit', (code) => resolve({ code, stdout: stdout + stderr })))
  // listening once it says so
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (stdout.includes('waiting for feedback')) {
        clearInterval(timer)
        resolve()
      } else if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(`redline wait exited: ${stdout}${stderr}`))
      }
    }, 50)
  })
  return { dir, channel: /redline: ([a-z]+-[a-z]+) waiting/.exec(stdout)![1]!, done, process: child }
}

export async function readPng(path: string): Promise<PNG> {
  return PNG.sync.read(await readFile(path))
}

export function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const i = (png.width * Math.round(y) + Math.round(x)) * 4
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!]
}

// close to Redline's first color, #e11d48
export function isRed([r, g, b]: [number, number, number]): boolean {
  return Math.abs(r - 0xe1) < 40 && Math.abs(g - 0x1d) < 40 && Math.abs(b - 0x48) < 40
}

// what the rounds of both browsers must show, once sent
export async function expectRound(bridge: Bridge, expect: typeof import('@playwright/test').expect) {
  const { code, stdout } = await bridge.done
  expect(code, stdout).toBe(0)
  expect(stdout).toContain('feedback, 1 snapshot, 2 annotations')
  const round = join(bridge.dir, bridge.channel, '001')
  const md = await readFile(join(round, 'feedback.md'), 'utf8')
  expect(md).toContain('**#1** rectangle')
  expect(md).toContain('> Make the button bigger')
  // the path from under <body>, the button the first of two
  expect(md).toContain('button.cta[1/2]`')
  expect(md).toContain('**#2** arrow from')
  expect(md).toContain('> Too much empty space here')
  expect(md).toContain('> Round 1, overall')

  const json = JSON.parse(await readFile(join(round, 'feedback.json'), 'utf8'))
  const [snapshot] = json.snapshots
  const rect = snapshot.annotations[0].rect
  expect(snapshot.annotations[0].target.selector).toContain('button')

  // the annotated screenshot has the rectangle's red border where the clean one has the page
  const clean = await readPng(join(round, 'S1.clean.png'))
  const annotated = await readPng(join(round, 'S1.annotated.png'))
  expect([annotated.width, annotated.height]).toEqual([clean.width, clean.height])
  const scale = clean.width / snapshot.viewport.width
  const edge = { x: (rect.x + rect.width / 2 - snapshot.viewport.scrollX) * scale, y: (rect.y - snapshot.viewport.scrollY) * scale }
  // the line is thin, and drawn over a white halo: red within two pixels of the edge
  const redNear = (png: PNG) => [-2, -1, 0, 1, 2].some((dy) => isRed(pixel(png, edge.x, edge.y + dy)))
  expect(redNear(annotated)).toBe(true)
  expect(redNear(clean)).toBe(false)
}
