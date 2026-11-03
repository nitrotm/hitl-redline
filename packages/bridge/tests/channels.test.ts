import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { CHANNEL_NAME, claimChannel, clearWait, drawName, listChannels, recordWait } from '../src/channels.ts'

beforeEach(async () => {
  process.env.REDLINE_HOME = await mkdtemp(join(tmpdir(), 'redline-home-'))
})

describe('channels', () => {
  it('are named adjective-pet', () => {
    for (let i = 0; i < 50; i++) expect(drawName()).toMatch(CHANNEL_NAME)
  })

  it('keep their name for their session, and give another session another', async () => {
    const a = await claimChannel({ session: 'claude-a', project: '/p' })
    expect((await claimChannel({ session: 'claude-a', project: '/p' })).name).toBe(a.name)
    const names = ['brave-cat', 'brave-cat', 'calm-dog']
    const b = await claimChannel({ session: 'claude-b', project: '/p', draw: () => names.shift()! })
    // brave-cat would be a's if a had drawn it: drawn again until free
    expect(b.name).not.toBe(a.name)
  })

  it('never share a name, even claimed at the same moment', async () => {
    const draws = () => {
      const names = ['brave-cat', 'calm-dog', 'shy-hen']
      return () => names.shift()!
    }
    const claimed = await Promise.all([1, 2, 3].map((n) => claimChannel({ session: `claude-${n}`, project: '/p', draw: draws() })))
    expect(new Set(claimed.map((c) => c.name)).size).toBe(3)
  })

  it('give a name asked for, unless another session has it', async () => {
    expect((await claimChannel({ session: 'claude-a', project: '/p', name: 'tiny-gecko' })).name).toBe('tiny-gecko')
    await expect(claimChannel({ session: 'claude-b', project: '/p', name: 'tiny-gecko' })).rejects.toThrow('the channel tiny-gecko is taken')
    await expect(claimChannel({ session: 'claude-b', project: '/p', name: 'Not A Name' })).rejects.toThrow('invalid channel name')
  })

  it('remember their wait until it ends, and are forgotten after a month unused', async () => {
    const channel = await claimChannel({ session: 'claude-a', project: '/p', name: 'tiny-gecko', now: new Date('2026-01-01T00:00:00Z') })
    await recordWait(channel, 12345, 47390)
    expect((await listChannels())[0]).toMatchObject({ pid: 12345, port: 47390 })
    // another wait's end leaves it be
    await clearWait('tiny-gecko', 999)
    expect((await listChannels())[0]).toMatchObject({ pid: 12345 })
    await clearWait('tiny-gecko', 12345)
    const file = join(process.env.REDLINE_HOME!, 'channels', 'tiny-gecko.json')
    expect(JSON.parse(await readFile(file, 'utf8')).pid).toBeUndefined()

    await writeFile(file, JSON.stringify({ name: 'tiny-gecko', session: 'claude-a', project: '/p', lastUsed: '2026-01-01T00:00:00Z' }))
    expect(await listChannels(new Date('2026-03-01T00:00:00Z'))).toEqual([])
    expect(await readdir(join(process.env.REDLINE_HOME!, 'channels'))).toEqual([])
  })
})
