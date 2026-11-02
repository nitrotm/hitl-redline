import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { renderFeedback, writeRound } from '../src/writer.ts'
import { makeRound } from './fixtures.ts'

describe('renderFeedback', () => {
  it('lists every annotation by id, in screenshot coordinates', () => {
    const md = renderFeedback(makeRound())
    expect(md).toContain('# Redline feedback: round 1')
    expect(md).toContain('> Overall too cramped.')
    expect(md).toContain('## S1: Home')
    expect(md).toContain('`S1.annotated.png`')
    // page y 500, scrolled by 400: 100 in the screenshot
    expect(md).toContain('- **#1** rectangle at (100, 100), 200×40 on `main > button.cta` "Sign up"\n\n  > Make this button bigger')
    expect(md).toContain('- **#2** freehand mark at (10, 20), 50×60 (no comment)')
  })

  it('tells Claude to stop when the round is the last', () => {
    expect(renderFeedback(makeRound({ status: 'done' }))).toContain('Status: **done**')
  })
})

describe('writeRound', () => {
  it('writes each round in a directory of its own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redline-'))
    const first = await writeRound(root, makeRound())
    const second = await writeRound(root, makeRound({ round: 2 }))

    expect(first.directory).toBe(join(root, 'rounds', '001'))
    expect(second.directory).toBe(join(root, 'rounds', '002'))
    expect(first.annotations).toBe(2)
    expect((await readdir(first.directory)).sort()).toEqual(['S1.annotated.png', 'S1.clean.png', 'feedback.json', 'feedback.md'])

    const png = await readFile(join(first.directory, 'S1.clean.png'))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const json = JSON.parse(await readFile(join(first.directory, 'feedback.json'), 'utf8'))
    expect(json.snapshots[0].images).toEqual({ clean: 'S1.clean.png', annotated: 'S1.annotated.png' })
  })
})
