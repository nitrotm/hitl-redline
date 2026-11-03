import { expect, test } from '@playwright/test'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import { CHROME_EXTENSION_ID } from '@redline/shared'

import { type Bridge, EXTENSION, serveFixtures, startBridge } from './helpers.ts'

// Chrome as the Chrome DevTools MCP runs it: launched over a CDP pipe, the extension installed with
// Extensions.loadUnpacked (branded Chrome has no --load-extension since 137), and a profile of its
// own, where `redline install --chrome-profile` put the native host. CDP is spoken here directly:
// Playwright cannot drive a browser launched this way.

const CLI = join(import.meta.dirname, '../../../bridge/src/cli.ts')

// CDP over --remote-debugging-pipe: JSON messages ended by a NUL, written to fd 3, read from fd 4
class Pipe {
  private next = 1
  private buffer = ''
  private waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>()

  constructor(
    private input: Writable,
    output: Readable
  ) {
    output.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let end: number
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end)) as { id?: number; result?: unknown; error?: { message: string } }
        this.buffer = this.buffer.slice(end + 1)
        if (message.id !== undefined) this.waiting.get(message.id)?.(message)
      }
    })
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.next++
    this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })}\0`)
    return new Promise((resolve, reject) =>
      this.waiting.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result as T)))
    )
  }

  // an expression's value in a target: a page, or the extension's
  async evaluate<T>(targetId: string, expression: string): Promise<T> {
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const { result } = await this.send<{ result: { value: T } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    return result.value
  }
}

let chrome: ChildProcess | undefined
let bridge: Bridge | undefined
let fixtures: Awaited<ReturnType<typeof serveFixtures>> | undefined

test.afterAll(() => {
  chrome?.kill()
  bridge?.process.kill()
  fixtures?.close()
})

test('install over CDP as the Chrome DevTools MCP does, pair from the profile, and send a round', async () => {
  fixtures = await serveFixtures()
  // the profile, with the native host that `redline install --chrome-profile` writes there; and a
  // home of its own, for the manifests it writes for the user's browsers too
  const profile = await mkdtemp(join(tmpdir(), 'redline-e2e-mcp-profile-'))
  const home = await mkdtemp(join(tmpdir(), 'redline-e2e-mcp-user-'))
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }
  const installed = await new Promise<number | null>((resolve) =>
    spawn(process.execPath, [CLI, 'install', '--chrome-profile', profile], { env }).on('exit', resolve)
  )
  expect(installed).toBe(0)

  chrome = spawn(
    process.env.CHROMIUM_PATH ?? 'chromium',
    [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--headless=new', '--no-first-run', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
  )
  const cdp = new Pipe(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable)

  // the key in the manifest fixes the id, which the native host lets in
  const { id } = await cdp.send<{ id: string }>('Extensions.loadUnpacked', { path: join(EXTENSION, 'chrome-mv3') })
  expect(id).toBe(CHROME_EXTENSION_ID)

  // paired by the native host of the profile: Redline starts by itself on the preview
  bridge = await startBridge(fixtures.url)
  const { targetId: page } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: fixtures.url })
  await expect.poll(() => cdp.evaluate<boolean>(page, `Boolean(document.querySelector('redline-overlay'))`), { timeout: 15_000 }).toBe(true)

  // a round with a comment, sent from an extension page as the sidebar sends it
  const { targetId: sidebar } = await cdp.send<{ targetId: string }>('Target.createTarget', {
    url: `chrome-extension://${id}/sidepanel.html?url=${encodeURIComponent(fixtures.url)}`,
  })
  await expect.poll(() => cdp.evaluate<string>(sidebar, 'document.readyState')).toBe('complete')
  await cdp.evaluate(
    sidebar,
    `(async () => {
      const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(fixtures.url)} })
      await chrome.runtime.sendMessage({ type: 'comment/set', tabId: tab.id, comment: 'Through the MCP way' })
      await chrome.runtime.sendMessage({ type: 'round/submit', tabId: tab.id, status: 'feedback' })
    })()`
  )
  const { code, stdout } = await bridge.done
  expect(code, stdout).toBe(0)
  expect(await readFile(join(bridge.dir, bridge.channel, '001', 'feedback.md'), 'utf8')).toContain('> Through the MCP way')
})
