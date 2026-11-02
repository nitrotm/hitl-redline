import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { waitForRound } from '../src/server.ts'
import { makeRound } from './fixtures.ts'

function listen() {
  return new Promise<{ port: number; root: string; received: ReturnType<typeof waitForRound> }>(async (resolve) => {
    const root = await mkdtemp(join(tmpdir(), 'redline-'))
    const received = waitForRound({
      port: 0,
      root,
      project: '/project',
      url: 'http://localhost:5173/',
      onListening: (port) => resolve({ port, root, received }),
    })
  })
}

// node's fetch sets neither Origin nor a Host of our choosing: http.request does
function post(port: number, body: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/rounds', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('waitForRound', () => {
  it('answers its status, with the extension that asked last', async () => {
    const { port, received } = await listen()
    const status = (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/status`, { headers }).then((r) => r.json())
    expect(await status()).toEqual({ app: 'redline', project: '/project', pid: process.pid, url: 'http://localhost:5173/' })
    await status({ 'x-redline-extension': 'moz-extension://0f1e2d3c-4b5a/' })
    await status({ 'x-redline-extension': 'https://evil.example/' })
    expect(await status()).toMatchObject({ extension: 'moz-extension://0f1e2d3c-4b5a/' })
    await post(port, JSON.stringify(makeRound()))
    await received
  })

  it('takes one round from the extension, and stops', async () => {
    const { port, received } = await listen()
    const response = await post(port, JSON.stringify(makeRound()), { origin: 'moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b' })
    expect(response.status).toBe(200)
    const { written } = await received
    expect(JSON.parse(response.body)).toEqual({ directory: written.directory })
    expect(await readFile(written.feedback, 'utf8')).toContain('**#1**')
  })

  it('refuses the origin of a web page, and another host', async () => {
    const { port, received } = await listen()
    expect((await post(port, JSON.stringify(makeRound()), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(port, JSON.stringify(makeRound()), { host: `evil.example:${port}` })).status).toBe(403)
    await post(port, JSON.stringify(makeRound()))
    await received
  })

  it('refuses an invalid round, and keeps waiting', async () => {
    const { port, received } = await listen()
    expect((await post(port, '{')).status).toBe(400)
    const invalid = await post(port, JSON.stringify({ ...makeRound(), version: 2 }))
    expect(invalid.status).toBe(400)
    expect(JSON.parse(invalid.body).error).toBe('invalid round')
    expect((await post(port, JSON.stringify(makeRound()))).status).toBe(200)
    await received
  })
})

describe('redline wait', () => {
  it('prints the feedback file and exits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'redline-'))
    const child = spawn(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), 'wait', '--port', '0', '--dir', dir])
    let stdout = ''
    const port = await new Promise<number>((resolve) =>
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk
        const match = /127\.0\.0\.1:(\d+)/.exec(stdout)
        if (match) resolve(Number(match[1]))
      })
    )
    expect((await post(port, JSON.stringify(makeRound()))).status).toBe(200)
    const code = await new Promise((resolve) => child.on('exit', resolve))
    expect(code).toBe(0)
    expect(stdout).toContain('round 1 of session session-1: feedback, 1 snapshot, 2 annotations')
    expect(stdout.trim().split('\n').at(-1)).toBe(join(dir, 'rounds', '001', 'feedback.md'))
  })

  it('gives up after its timeout', async () => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), 'wait', '--port', '0', '--timeout', '0.2'])
    const code = await new Promise((resolve) => child.on('exit', resolve))
    expect(code).toBe(2)
  })
})
