import { mkdtemp, readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { HEADERS, askBridge, importToken, roundAuth } from '@redline/shared'

import { readOrCreateToken } from '../../bridge/src/home.ts'
import { makeRound } from '../../bridge/tests/fixtures.ts'
import { type Context, type Pi, createExtension } from '../src/index.ts'

const CLI = join(import.meta.dirname, '../../bridge/src/cli.ts')

// pi, as far as the extension sees it: its tool, its handlers, the messages it sends
function fakePi() {
  const pi = {
    tools: [] as Parameters<Pi['registerTool']>[0][],
    handlers: [] as (() => void | Promise<void>)[],
    messages: [] as string[],
    registerTool: (tool: Parameters<Pi['registerTool']>[0]) => void pi.tools.push(tool),
    on: (_event: string, handler: () => void) => void pi.handlers.push(handler),
    sendUserMessage: (content: string) => void pi.messages.push(content),
  }
  return pi
}

async function post(port: number) {
  const key = await importToken(await readOrCreateToken())
  const asked = await askBridge(port, key)
  if (asked?.kind !== 'bridge') throw new Error('no bridge')
  const body = JSON.stringify(makeRound())
  const auth = await roundAuth(key, asked.bridge, body)
  return new Promise<number>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/rounds', method: 'POST', headers: { 'content-type': 'application/json', [HEADERS.auth]: auth } },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('the pi extension', () => {
  it('waits in the background, and starts a turn with the round', async () => {
    const pi = fakePi()
    createExtension([process.execPath, CLI])(pi)
    const [tool] = pi.tools
    expect(tool?.name).toBe('redline_wait')

    const cwd = await mkdtemp(join(tmpdir(), 'redline-pi-'))
    const ctx: Context = { cwd, sessionManager: { getSessionId: () => 'pi-session-1' } }
    const result = await tool!.execute('call-1', { url: 'http://127.0.0.1:5173/' }, undefined, undefined, ctx)
    const text = result.content[0]!.text
    expect(text).toMatch(/[a-z]+-[a-z]+ waiting for feedback/)
    expect(text).toContain('End your turn')
    expect(pi.messages).toEqual([])

    const port = Number(/127\.0\.0\.1:(\d+)/.exec(text)![1])
    const asked = await askBridge(port, await importToken(await readOrCreateToken()))
    expect(asked?.kind === 'bridge' && asked.bridge.status).toMatchObject({ agent: 'pi', url: 'http://127.0.0.1:5173/' })

    expect(await post(port)).toBe(200)
    await expect.poll(() => pi.messages.length).toBe(1)
    const channel = /([a-z]+-[a-z]+) waiting/.exec(text)![1]!
    const feedback = join(cwd, '.redline', channel, '001', 'feedback.md')
    expect(pi.messages[0]).toContain(`Read ${feedback}`)
    expect(await readFile(feedback, 'utf8')).toContain('**#1**')
  })

  it('sends nothing for a wait that a newer one replaced, or that pi stopped', async () => {
    const pi = fakePi()
    createExtension([process.execPath, CLI])(pi)
    const cwd = await mkdtemp(join(tmpdir(), 'redline-pi-'))
    const ctx: Context = { cwd, sessionManager: { getSessionId: () => 'pi-session-2' } }
    const first = await pi.tools[0]!.execute('1', { url: 'http://127.0.0.1:5173/' }, undefined, undefined, ctx)
    const second = await pi.tools[0]!.execute('2', { url: 'http://127.0.0.1:5173/', reload: true }, undefined, undefined, ctx)
    // the same session, the same channel
    const channel = (text: string) => /([a-z]+-[a-z]+) waiting/.exec(text)?.[1]
    expect(channel(second.content[0]!.text)).toBe(channel(first.content[0]!.text))
    for (const handler of pi.handlers) await handler()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(pi.messages).toEqual([])
  })

  it('says when redline cannot start', async () => {
    const pi = fakePi()
    createExtension(['/nonexistent/redline'])(pi)
    const result = await pi.tools[0]!.execute('1', { url: 'http://127.0.0.1:5173/' }, undefined, undefined, { cwd: tmpdir() })
    expect(result.content[0]!.text).toContain('redline wait did not start')
    expect(result.details).toEqual({ error: true })
  })
})
