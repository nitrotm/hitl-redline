import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { type Bridge, HEADERS, MAX_ROUND_BYTES, askBridge, importToken, mac, randomNonce, roundAuth } from '@redline/shared'

import { readOrCreateToken } from '../src/home.ts'
import { waitForRound } from '../src/server.ts'
import { makeRound } from './fixtures.ts'

const reply = { sessionId: 'session-1', round: 1, questions: [{ id: 'Q1', text: 'Which John?' }] }
const key = await importToken('the test token')

function listen(options: { root?: string; channel?: string } = {}) {
  return new Promise<{ port: number; root: string; received: ReturnType<typeof waitForRound> }>(async (resolve) => {
    const root = options.root ?? (await mkdtemp(join(tmpdir(), 'redline-')))
    const received = waitForRound({
      ports: [0],
      root,
      project: '/project',
      channel: options.channel ?? 'brave-cat',
      key,
      url: 'http://localhost:5173/',
      reply,
      onListening: (port) => resolve({ port, root, received }),
    })
  })
}

async function statusOf(port: number): Promise<Bridge> {
  const asked = await askBridge(port, key)
  if (asked?.kind !== 'bridge') throw new Error(`no bridge on ${port}`)
  return asked.bridge
}

// node's fetch sets neither Origin nor a Host of our choosing: http.request does
function raw(port: number, path: string, method: string, body: string | Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

// a round, signed for the bridge on PORT, as the extension sends it
async function post(port: number, body: string, headers: Record<string, string> = {}) {
  const auth = await roundAuth(key, await statusOf(port), body)
  return raw(port, '/rounds', 'POST', body, { 'content-type': 'application/json', [HEADERS.auth]: auth, ...headers })
}

describe('waitForRound', () => {
  it('answers its status, signed, with the extension that asked last', async () => {
    const { port, received } = await listen()
    expect((await statusOf(port)).status).toMatchObject({
      app: 'redline',
      channel: 'brave-cat',
      project: '/project',
      pid: process.pid,
      url: 'http://localhost:5173/',
      reply,
    })
    await askBridge(port, key, 'moz-extension://0f1e2d3c-4b5a/')
    await askBridge(port, key, 'https://evil.example/')
    expect((await statusOf(port)).status).toMatchObject({ extension: 'moz-extension://0f1e2d3c-4b5a/' })
    await post(port, JSON.stringify(makeRound()))
    await received
  })

  it('tells nothing to who does not know the token', async () => {
    const { port, received } = await listen()
    const nonce = randomNonce()
    const unsigned = await raw(port, '/status', 'GET', '', { [HEADERS.nonce]: nonce })
    expect(unsigned.status).toBe(401)
    expect(JSON.parse(unsigned.body)).toEqual({ app: 'redline', error: 'not paired' })
    const wrong = await raw(port, '/status', 'GET', '', {
      [HEADERS.nonce]: nonce,
      [HEADERS.auth]: await mac(await importToken('another'), 'status', port, nonce),
    })
    expect(wrong.status).toBe(401)
    expect(await askBridge(port, await importToken('another'))).toEqual({ kind: 'unpaired', port })
    // a MAC made for another port, relayed here, does not do
    const relayed = await raw(port, '/status', 'GET', '', { [HEADERS.nonce]: nonce, [HEADERS.auth]: await mac(key, 'status', port + 1, nonce) })
    expect(relayed.status).toBe(401)
    await post(port, JSON.stringify(makeRound()))
    await received
  })

  it('refuses a round without the MAC of its body, or of another run', async () => {
    const { port, received } = await listen()
    const body = JSON.stringify(makeRound())
    const json = { 'content-type': 'application/json' }
    expect((await raw(port, '/rounds', 'POST', body, json)).status).toBe(401)
    const other = await roundAuth(key, await statusOf(port), JSON.stringify(makeRound({ comment: 'Something else' })))
    expect((await raw(port, '/rounds', 'POST', body, { ...json, [HEADERS.auth]: other })).status).toBe(401)
    const bridge = await statusOf(port)
    const earlier = await roundAuth(key, { ...bridge, status: { ...bridge.status, nonce: randomNonce() } }, body)
    expect((await raw(port, '/rounds', 'POST', body, { ...json, [HEADERS.auth]: earlier })).status).toBe(401)
    expect((await post(port, body)).status).toBe(200)
    await received
  })

  it('takes one round from the extension, writes it for the user only, and stops', async () => {
    const { port, received } = await listen()
    const response = await post(port, JSON.stringify(makeRound()), { origin: 'moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' })
    expect(response.status).toBe(200)
    const { written } = await received
    expect(JSON.parse(response.body)).toEqual({ directory: written.directory })
    const md = await readFile(written.feedback, 'utf8')
    expect(md).toContain('**#1**')
    expect(md).toContain('- Channel: `brave-cat`')
    if (process.platform !== 'win32') {
      expect((await stat(written.directory)).mode & 0o777).toBe(0o700)
      expect((await stat(written.feedback)).mode & 0o777).toBe(0o600)
    }
  })

  it('refuses the origin of a web page, and another host name, on any port', async () => {
    const { port, received } = await listen()
    expect((await post(port, JSON.stringify(makeRound()), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(port, JSON.stringify(makeRound()), { host: `evil.example:${port}` })).status).toBe(403)
    // a forwarded port (ssh -L 47391:127.0.0.1:47390) names its own
    const nonce = randomNonce()
    const forwarded = await raw(port, '/status', 'GET', '', {
      host: 'localhost:47391',
      [HEADERS.nonce]: nonce,
      [HEADERS.auth]: await mac(key, 'status', port, nonce),
    })
    expect(forwarded.status).toBe(200)
    await post(port, JSON.stringify(makeRound()))
    await received
  })

  it('answers a round too large with 413, and keeps waiting', async () => {
    const { port, received } = await listen()
    const big = Buffer.alloc(MAX_ROUND_BYTES + 1, 'a')
    const response = await raw(port, '/rounds', 'POST', big, { 'content-type': 'application/json', [HEADERS.auth]: 'x' })
    expect(response.status).toBe(413)
    expect((await post(port, JSON.stringify(makeRound()))).status).toBe(200)
    await received
  })

  it('stops with the error when the round cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redline-'))
    // a file where the channel's directory goes
    await writeFile(join(root, 'brave-cat'), '')
    const { port, received } = await listen({ root })
    const outcome = received.then(
      () => 'written',
      (error: Error) => error.message
    )
    expect((await post(port, JSON.stringify(makeRound()))).status).toBe(500)
    expect(await outcome).toMatch(/EEXIST|ENOTDIR/)
  })

  it('listens on the next port while one is in use', async () => {
    const busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
    const taken = (busy.address() as { port: number }).port
    const free = createServer()
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve))
    const next = (free.address() as { port: number }).port
    await new Promise((resolve) => free.close(resolve))

    const root = await mkdtemp(join(tmpdir(), 'redline-'))
    const port = await new Promise<number>(
      (resolve) => void waitForRound({ ports: [taken, next], root, project: '/p', channel: 'calm-dog', key, onListening: resolve }).catch(() => undefined)
    )
    expect(port).toBe(next)
    await post(port, JSON.stringify(makeRound()))
    busy.close()
  })

  it('refuses an invalid round, and keeps waiting', async () => {
    const { port, received } = await listen()
    expect((await post(port, '{')).status).toBe(400)
    const invalid = await post(port, JSON.stringify({ ...makeRound(), version: 1 }))
    expect(invalid.status).toBe(400)
    expect(JSON.parse(invalid.body).error).toBe('invalid round')
    expect((await post(port, JSON.stringify(makeRound()))).status).toBe(200)
    await received
  })
})

const CLI = join(import.meta.dirname, '../src/cli.ts')

// `redline wait`, until it says where it listens
function startWait(args: string[], cwd?: string) {
  const child = spawn(process.execPath, [CLI, 'wait', '--port', '0', ...args], { cwd })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
  const exit = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const listening = new Promise<{ port: number; channel: string }>((resolve) =>
    child.stdout.on('data', () => {
      const match = /redline: ([a-z]+-[a-z]+) waiting for feedback on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout)
      if (match) resolve({ channel: match[1]!, port: Number(match[2]) })
    })
  )
  return { child, exit, listening, stdout: () => stdout }
}

describe('redline wait', () => {
  it('prints its channel, then the feedback file, and exits', async () => {
    const key = await importToken(await readOrCreateToken())
    const dir = await mkdtemp(join(tmpdir(), 'redline-'))
    const wait = startWait(['--dir', dir, '--session', 'claude-1'])
    const { port, channel } = await wait.listening
    const asked = await askBridge(port, key)
    expect(asked?.kind === 'bridge' && asked.bridge.status.channel).toBe(channel)
    const body = JSON.stringify(makeRound())
    const auth = await roundAuth(key, (asked as { bridge: Bridge }).bridge, body)
    expect((await raw(port, '/rounds', 'POST', body, { 'content-type': 'application/json', [HEADERS.auth]: auth })).status).toBe(200)
    expect(await wait.exit).toBe(0)
    expect(wait.stdout()).toContain('round 1 of session session-1: feedback, 1 snapshot, 2 annotations')
    expect(wait.stdout().trim().split('\n').at(-1)).toBe(join(dir, channel, '001', 'feedback.md'))
  })

  it("keeps a session's channel, and stops its last wait, not another session's", async () => {
    const first = startWait(['--session', 'claude-a'])
    const other = startWait(['--session', 'claude-b'])
    const a = await first.listening
    const b = await other.listening
    expect(a.channel).not.toBe(b.channel)

    const again = startWait(['--session', 'claude-a'])
    expect((await again.listening).channel).toBe(a.channel)
    expect(await first.exit).toBe(3)
    expect(first.stdout()).toContain('replaced by a newer wait')
    // the other session's wait listens still
    expect(other.child.exitCode).toBeNull()
    again.child.kill()
    other.child.kill()
  })

  it('refuses a channel that another session has', async () => {
    const first = startWait(['--session', 'claude-c'])
    const { channel } = await first.listening
    const thief = spawn(process.execPath, [CLI, 'wait', '--port', '0', '--session', 'claude-d', '--channel', channel])
    let stderr = ''
    thief.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
    expect(await new Promise((resolve) => thief.on('exit', resolve))).toBe(1)
    expect(stderr).toContain(`the channel ${channel} is taken`)
    first.child.kill()
  })

  it('refuses a reply that is not one, and a preview that is not a page', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'redline-'))
    const file = join(dir, 'reply.json')
    await writeFile(file, JSON.stringify({ round: 1 }))
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [CLI, 'wait', '--port', '0', ...args])
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
        child.on('exit', (code) => resolve({ code, stderr }))
      })
    expect(await run(['--reply', file])).toMatchObject({ code: 1, stderr: expect.stringContaining('is not a reply: sessionId') })
    expect(await run(['--url', 'file:///etc/passwd'])).toMatchObject({ code: 1, stderr: expect.stringContaining('not an http(s) URL') })
  })

  it('gives up after its timeout', async () => {
    const child = spawn(process.execPath, [CLI, 'wait', '--port', '0', '--timeout', '0.2'])
    const code = await new Promise((resolve) => child.on('exit', resolve))
    expect(code).toBe(2)
  })
})

describe('any agent', () => {
  it('names itself and asks for reloads in the status, and serves the reply where reply-path says', async () => {
    const key = await importToken(await readOrCreateToken())
    const dir = await mkdtemp(join(tmpdir(), 'redline-'))
    const env = { ...process.env, REDLINE_SESSION: 'codex-thread-1' }
    const replyFile = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [CLI, 'reply-path', '--dir', dir], { env })
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk))
      child.on('exit', () => resolve(out.trim()))
    })
    // beside the channel's rounds
    expect(replyFile).toMatch(/\/[a-z]+-[a-z]+\/reply\.json$/)
    expect(dirname(dirname(replyFile))).toBe(dir)
    await mkdir(dirname(replyFile), { recursive: true })
    await writeFile(replyFile, JSON.stringify(reply))

    const child = spawn(process.execPath, [CLI, 'wait', '--port', '0', '--dir', dir, '--agent', 'Codex', '--reload'], { env })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
    const port = await new Promise<number>((resolve) =>
      child.stdout.on('data', () => {
        const match = /127\.0\.0\.1:(\d+)/.exec(stdout)
        if (match) resolve(Number(match[1]))
      })
    )
    const asked = await askBridge(port, key)
    expect(asked?.kind === 'bridge' && asked.bridge.status).toMatchObject({ agent: 'Codex', reload: true, reply })
    expect(stdout).toContain(`the reply to its rounds goes to ${replyFile}`)
    child.kill()
  })

  it('opens only a page', async () => {
    const child = spawn(process.execPath, [CLI, 'open', 'file:///etc/passwd'])
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
    expect(await new Promise((resolve) => child.on('exit', resolve))).toBe(1)
    expect(stderr).toContain('not an http(s) URL')
  })
})
