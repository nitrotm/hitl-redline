import { describe, expect, it } from 'vitest'

import { commonPrefix, pathText, stepText } from '../src/path.ts'

describe('stepText', () => {
  it('names a step by what tells it apart', () => {
    expect(stepText({ tag: 'button', classes: ['cta'], nth: 1, of: 2 })).toBe('button.cta[1/2]')
    expect(stepText({ tag: 'main', id: 'app' })).toBe('main#app')
    expect(stepText({ tag: 'div', testId: 'hero', role: 'region', label: 'Welcome' })).toBe('div[testid=hero][role=region][label="Welcome"]')
    expect(stepText({ tag: 'my-card', shadow: true })).toBe('my-card ::shadow')
  })
})

describe('pathText', () => {
  it('writes the same step one after the other once', () => {
    expect(pathText([{ tag: 'main', id: 'app' }, { tag: 'div' }, { tag: 'div' }, { tag: 'div' }, { tag: 'button' }])).toBe('main#app > div ×3 > button')
  })
})

describe('commonPrefix', () => {
  it('is the steps every path begins with', () => {
    const a = [{ tag: 'main' }, { tag: 'section', classes: ['hero'] }, { tag: 'h2' }]
    const b = [{ tag: 'main' }, { tag: 'section', classes: ['hero'] }, { tag: 'button' }]
    expect(commonPrefix([a, b])).toEqual(a.slice(0, 2))
    expect(commonPrefix([a, [{ tag: 'footer' }]])).toEqual([])
  })
})
