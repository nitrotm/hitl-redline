import { beforeEach, describe, expect, it } from 'vitest'

import { cssSelector, domPath } from '../../src/target-hint.ts'

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

describe('domPath', () => {
  it('names each step from under <body> down to the element', () => {
    document.body.innerHTML = `
      <main id="app">
        <section class="hero css-1x2y3z" data-testid="hero">
          <button class="btn primary">Sign up</button>
          <button class="btn" aria-label="Log in">Log in</button>
        </section>
      </main>`
    const button = document.querySelectorAll('button')[1]!
    expect(domPath(button)).toEqual([
      { tag: 'main', id: 'app' },
      { tag: 'section', classes: ['hero'], testId: 'hero' },
      { tag: 'button', classes: ['btn'], label: 'Log in', nth: 2, of: 2 },
    ])
  })

  it('goes through a shadow root, its host marked', () => {
    document.body.innerHTML = '<div class="card"></div>'
    const host = document.querySelector('.card')!
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<p class="title">Hello</p>'
    expect(domPath(root.querySelector('p')!)).toEqual([
      { tag: 'div', classes: ['card'], shadow: true },
      { tag: 'p', classes: ['title'] },
    ])
  })
})
