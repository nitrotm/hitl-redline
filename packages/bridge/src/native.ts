import { execFile } from 'node:child_process'
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, NATIVE_HOST } from '@redline/shared'

import { ensureHome, readOrCreateToken, redlineHome } from './home.ts'

// The native messaging host: the browser starts it, as the user, and it hands the extension the
// user's token. That is how the extension learns it without anyone else on the machine being able
// to: only the user's browser runs it, and only the user reads the token.

export type BrowserKind = 'firefox' | 'chrome'

// The host's messages, on stdio: a 32-bit length in native order (little-endian wherever browsers
// run), then that much JSON.
export function readNativeMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    input.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < 4) return
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      try {
        resolve(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    input.on('end', () => resolve(undefined))
    input.on('error', reject)
  })
}

export function encodeNativeMessage(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(json.length, 0)
  return Buffer.concat([length, json])
}

// `redline native-host`: one request, one answer
export async function runNativeHost(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  const request = (await readNativeMessage(input)) as { type?: unknown } | undefined
  const reply = request?.type === 'token' ? { token: await readOrCreateToken() } : { error: 'unknown request' }
  await new Promise<void>((resolve) => output.write(encodeNativeMessage(reply), () => resolve()))
}

export function nativeManifest(browser: BrowserKind, path: string) {
  return {
    name: NATIVE_HOST,
    description: "Redline: hands the extension the user's token, which `redline wait` checks",
    path,
    type: 'stdio',
    ...(browser === 'firefox' ? { allowed_extensions: [FIREFOX_EXTENSION_ID] } : { allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] }),
  }
}

interface Target {
  browser: BrowserKind
  label: string
  // the directory of the manifests (Linux, macOS), or the registry key (Windows)
  dir?: string
  key?: string
  // written only if the browser is there: its own directory
  if?: string
}

// On Linux and macOS, a Chrome looks for native hosts in its profile's directory: the Chrome
// DevTools MCP's has a profile of its own (chrome-profile, with its channel after it, when not
// stable), and it sees none of the user's Chrome. The registry, on Windows, is every profile's.
async function chromeProfiles(extra: string[]): Promise<Target[]> {
  if (process.platform === 'win32') return []
  const cache = join(homedir(), '.cache', 'chrome-devtools-mcp')
  const found = (await readdir(cache).catch(() => [] as string[])).filter((name) => name.startsWith('chrome-profile')).map((name) => join(cache, name))
  return [...found, ...extra].map((dir) => ({ browser: 'chrome', label: `Chrome (${dir})`, dir: join(dir, 'NativeMessagingHosts') }))
}

function targets(): Target[] {
  const home = homedir()
  if (process.platform === 'win32')
    return [
      { browser: 'firefox', label: 'Firefox', key: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST}` },
      { browser: 'chrome', label: 'Chrome', key: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST}` },
      { browser: 'chrome', label: 'Chromium', key: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST}` },
    ]
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return [
      { browser: 'firefox', label: 'Firefox', dir: join(support, 'Mozilla', 'NativeMessagingHosts') },
      { browser: 'chrome', label: 'Chrome', dir: join(support, 'Google', 'Chrome', 'NativeMessagingHosts'), if: join(support, 'Google', 'Chrome') },
      { browser: 'chrome', label: 'Chromium', dir: join(support, 'Chromium', 'NativeMessagingHosts'), if: join(support, 'Chromium') },
    ]
  }
  const config = process.env.XDG_CONFIG_HOME || join(home, '.config')
  return [
    // Firefox's, even before it ran once: the firefox-devtools MCP's runs with a profile elsewhere
    { browser: 'firefox', label: 'Firefox', dir: join(home, '.mozilla', 'native-messaging-hosts') },
    { browser: 'chrome', label: 'Chrome', dir: join(config, 'google-chrome', 'NativeMessagingHosts'), if: join(config, 'google-chrome') },
    { browser: 'chrome', label: 'Chromium', dir: join(config, 'chromium', 'NativeMessagingHosts'), if: join(config, 'chromium') },
  ]
}

// A manifest's path takes no arguments, and a browser started from the desktop may have no PATH:
// a script of the host, with this node and this redline, in full.
export async function writeHostScript(cli: string): Promise<string> {
  const dir = await ensureHome()
  // a home of its own (tests, a container's): the host reads the token there too
  const home = process.env.REDLINE_HOME ? redlineHome() : undefined
  if (process.platform === 'win32') {
    const path = join(dir, 'native-host.bat')
    const lines = ['@echo off', ...(home ? [`set "REDLINE_HOME=${home}"`] : []), `"${process.execPath}" "${cli}" native-host %*`]
    await writeFile(path, `${lines.join('\r\n')}\r\n`)
    return path
  }
  const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  const path = join(dir, 'native-host')
  const lines = [
    '#!/bin/sh',
    ...(home ? [`REDLINE_HOME=${quote(home)}`, 'export REDLINE_HOME'] : []),
    `exec ${quote(process.execPath)} ${quote(cli)} native-host "$@"`,
  ]
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o700 })
  return path
}

// `redline install`: the token, the host and its manifests, for each browser there, and the
// Chrome profiles given (PROFILES: an MCP's `--userDataDir`). What it did, one line each.
export async function install(cli: string, profiles: string[] = []): Promise<string[]> {
  await readOrCreateToken()
  const host = await writeHostScript(cli)
  const done = [`token: ${join(redlineHome(), 'token')}`, `native host: ${host}`]
  for (const target of [...targets(), ...(await chromeProfiles(profiles))]) {
    if (target.if && !(await exists(target.if))) continue
    const manifest = `${JSON.stringify(nativeManifest(target.browser, host), null, 2)}\n`
    if (target.dir) {
      await mkdir(target.dir, { recursive: true })
      const path = join(target.dir, `${NATIVE_HOST}.json`)
      await writeFile(path, manifest)
      done.push(`${target.label}: ${path}`)
    } else if (target.key) {
      const path = join(redlineHome(), `${NATIVE_HOST}.${target.browser}.json`)
      await writeFile(path, manifest)
      await promisify(execFile)('reg', ['add', target.key, '/ve', '/t', 'REG_SZ', '/d', path, '/f'])
      done.push(`${target.label}: ${target.key} → ${path}`)
    }
  }
  return done
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}
