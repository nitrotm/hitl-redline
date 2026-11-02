import { beforeEach, describe, expect, it } from 'vitest'

import { cssSelector } from '../../src/target-hint.ts'

describe('cssSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app">
        <section class="hero">
          <button class="btn primary css-1x2y3z">Sign up</button>
          <button class="btn">Log in</button>
        </section>
        <ul><li>One</li><li>Two</li></ul>
      </main>`
  })

  it('stops at a unique id', () => {
    expect(cssSelector(document.getElementById('app')!)).toBe('#app')
  })

  it('names an element by its classes, without the generated ones', () => {
    expect(cssSelector(document.querySelector('.primary')!)).toBe('button.btn.primary')
  })

  it('ranks an element among its alike siblings', () => {
    const second = document.querySelectorAll('li')[1]!
    const selector = cssSelector(second)
    expect(selector).toMatch(/li:nth-of-type\(2\)$/)
    expect(document.querySelector(selector)).toBe(second)
  })
})
