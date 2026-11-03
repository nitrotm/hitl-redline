import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { type Proc, agentProcess, isPassThrough, parseProcStat, parsePs, processInfo, sessionKey } from '../src/agent.ts'

describe('the agent process', () => {
  it('is read from /proc, whatever its name holds', () => {
    const stat = '4242 (my (odd) agent) S 4000 4242 4000 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10 18446744073709551615'
    expect(parseProcStat(stat)).toEqual({ pid: 4242, ppid: 4000, name: 'my (odd) agent', start: '987654' })
  })

  it('is read from ps, on macOS', () => {
    expect(parsePs(77, '  1234 Mon Nov  3 12:00:00 2026     /Applications/Codex.app/codex\n')).toEqual({
      pid: 77,
      ppid: 1234,
      name: 'codex',
      start: 'Mon Nov 3 12:00:00 2026',
    })
  })

  it('is the first one above that is neither a shell nor a sandbox', async () => {
    expect(['bash', '-zsh', 'sh', 'bwrap', 'codex-linux-sandbox', 'pwsh.exe', 'timeout'].every(isPassThrough)).toBe(true)
    expect(['claude', 'codex', 'node', 'pi', 'tmux'].some(isPassThrough)).toBe(false)
    const tree: Record<number, Proc> = {
      30: { pid: 30, ppid: 20, name: 'bash', start: 'c' },
      20: { pid: 20, ppid: 10, name: 'codex-linux-sandbox', start: 'b' },
      10: { pid: 10, ppid: 1, name: 'codex', start: 'a' },
    }
    expect(await agentProcess(30, async (pid) => tree[pid])).toEqual(tree[10])
    expect(await agentProcess(30, async () => undefined)).toBeUndefined()
  })

  it('makes the key, unless REDLINE_SESSION gives one', async () => {
    const agent = async () => ({ pid: 10, ppid: 1, name: 'codex', start: 'a' })
    expect(await sessionKey('/p', {}, agent)).toBe('codex:10:a:/p')
    expect(await sessionKey('/p', { REDLINE_SESSION: 'mine' }, agent)).toBe('mine')
    expect(await sessionKey('/p', {}, async () => undefined)).toBe('/p')
  })

  it.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')('is found for real, through the shells of a command', async () => {
    // this test's process, above two shells and the CLI
    const me = await processInfo(process.pid)
    expect(me).toBeDefined()
    const script = join(import.meta.dirname, 'print-agent.ts')
    const found = await new Promise<string>((resolve) => {
      const child = spawn('sh', ['-c', `sh -c '"${process.execPath}" "${script}"'`])
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk))
      child.on('exit', () => resolve(out))
    })
    expect(JSON.parse(found)).toMatchObject({ pid: process.pid, start: me!.start })
  })
})
