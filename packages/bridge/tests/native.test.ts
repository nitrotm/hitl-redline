import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID } from '@redline/shared'

import { readOrCreateToken } from '../src/home.ts'
import { encodeNativeMessage } from '../src/native.ts'

const CLI = join(import.meta.dirname, '../src/cli.ts')

function run(args: string[], env: Record<string, string> = {}, input?: Buffer): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('exit', (code) => resolve({ code, stdout: Buffer.concat(chunks) }))
    child.stdin.end(input)
  })
}

describe('the token', () => {
  it('is made once, for the user only', async () => {
    const token = await readOrCreateToken()
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(await readOrCreateToken()).toBe(token)
    if (process.platform !== 'win32') expect((await stat(join(process.env.REDLINE_HOME!, 'token'))).mode & 0o777).toBe(0o600)
    expect((await run(['token'])).stdout.toString().trim()).toBe(token)
  })
})

describe('redline native-host', () => {
  it("answers the extension's request with the token, as the browser starts it", async () => {
    const token = await readOrCreateToken()
    // Firefox's arguments: the manifest, the extension
    const { code, stdout } = await run(['native-host', '/path/redline_bridge.json', FIREFOX_EXTENSION_ID], {}, encodeNativeMessage({ type: 'token' }))
    expect(code).toBe(0)
    const length = stdout.readUInt32LE(0)
    expect(JSON.parse(stdout.subarray(4, 4 + length).toString())).toEqual({ token })
  })
})

describe('redline install', () => {
  it.skipIf(process.platform === 'win32')('writes the host, and its manifest for each browser there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'redline-user-'))
    const { code, stdout } = await run(['install'], { HOME: home, XDG_CONFIG_HOME: join(home, '.config') })
    expect(code, stdout.toString()).toBe(0)
    const support =
      process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
        : join(home, '.mozilla', 'native-messaging-hosts')
    const manifest = JSON.parse(await readFile(join(support, 'redline_bridge.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'redline_bridge', type: 'stdio', allowed_extensions: [FIREFOX_EXTENSION_ID] })
    // the host: this node and this redline, with the home the token is in
    const script = await readFile(manifest.path, 'utf8')
    expect(script).toContain(process.execPath)
    expect(script).toContain(CLI)
    expect(script).toContain(`REDLINE_HOME='${process.env.REDLINE_HOME}'`)
    expect(stdout.toString()).not.toContain('Chrome:')
    expect(CHROME_EXTENSION_ID).toMatch(/^[a-p]{32}$/)

    // and it hands the token
    const host = await new Promise<Buffer>((resolve) => {
      const child = spawn(manifest.path, [])
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('exit', () => resolve(Buffer.concat(chunks)))
      child.stdin.end(encodeNativeMessage({ type: 'token' }))
    })
    expect(JSON.parse(host.subarray(4).toString())).toEqual({ token: await readOrCreateToken() })
  })

  it.skipIf(process.platform === 'win32')("leaves a manifest that is a link: home-manager's, into the Nix store", async () => {
    const home = await mkdtemp(join(tmpdir(), 'redline-user-'))
    const support =
      process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
        : join(home, '.mozilla', 'native-messaging-hosts')
    await mkdir(support, { recursive: true })
    const theirs = join(home, 'store-redline_bridge.json')
    await writeFile(theirs, '{"path": "/nix/store/…-redline/libexec/redline-native-host"}\n')
    await symlink(theirs, join(support, 'redline_bridge.json'))
    const { code, stdout } = await run(['install'], { HOME: home, XDG_CONFIG_HOME: join(home, '.config') })
    expect(code, stdout.toString()).toBe(0)
    expect(stdout.toString()).toContain(`a link to ${theirs}, left as it is`)
    expect(await readFile(theirs, 'utf8')).toContain('/nix/store/')
  })
})

describe('the Chrome DevTools MCP', () => {
  it.skipIf(process.platform === 'win32')("gets the host in its Chrome's profile, found or given", async () => {
    const home = await mkdtemp(join(tmpdir(), 'redline-user-'))
    const profile = join(home, '.cache', 'chrome-devtools-mcp', 'chrome-profile')
    await mkdir(profile, { recursive: true })
    const given = await mkdtemp(join(tmpdir(), 'redline-profile-'))
    const { code, stdout } = await run(['install', '--chrome-profile', given], { HOME: home, XDG_CONFIG_HOME: join(home, '.config') })
    expect(code, stdout.toString()).toBe(0)
    for (const dir of [profile, given]) {
      const manifest = JSON.parse(await readFile(join(dir, 'NativeMessagingHosts', 'redline_bridge.json'), 'utf8'))
      expect(manifest).toMatchObject({ name: 'redline_bridge', allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] })
    }
    expect(stdout.toString()).toContain(`Chrome (${profile})`)
  })

  it('takes the Chrome build from extension-path chrome', async () => {
    const { code, stdout } = await run(['extension-path', 'chrome'], { REDLINE_EXTENSION_CHROME: '/somewhere/chrome' })
    expect(code).toBe(0)
    expect(stdout.toString().trim()).toBe('/somewhere/chrome')
    expect((await run(['extension-path', 'safari'])).code).toBe(1)
  })
})
