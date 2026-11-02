import { render } from 'preact'
import { jsxDEV } from 'preact/jsx-runtime'
import { beforeEach, describe, expect, it } from 'vitest'

import { TARGET_ATTRIBUTE, inspectPage } from '../../src/frameworks.ts'

// a Preact app as a development build makes it: jsxDEV, with where each JSX is
const at = (line: number) => ({ fileName: '/project/src/App.tsx', lineNumber: line, columnNumber: 5 })
const dev = jsxDEV as unknown as (type: unknown, props: object, key?: string, isStatic?: boolean, source?: object) => preact.VNode

function Button(props: { label: string }) {
  return dev('button', { class: 'cta', children: props.label }, undefined, false, at(3))
}
function Hero() {
  return dev(
    'section',
    { class: 'hero', children: [dev('h2', { children: 'Hello' }, undefined, false, at(7)), dev(Button, { label: 'Sign up' }, undefined, false, at(8))] },
    undefined,
    true,
    at(6)
  )
}
function App() {
  return dev('main', { id: 'app', children: dev(Hero, {}, undefined, false, at(12)) }, undefined, false, at(11))
}

function mark(element: Element): string {
  element.setAttribute(TARGET_ATTRIBUTE, 'n1')
  return 'n1'
}

describe('inspectPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    render(dev(App, {}), document.getElementById('root')!)
  })

  it("names a Preact element's components, and where its JSX is", () => {
    expect(inspectPage(mark(document.querySelector('button')!))).toEqual({
      framework: 'preact',
      components: ['App', 'Hero', 'Button'],
      source: { file: '/project/src/App.tsx', line: 3, column: 5 },
    })
    document.querySelector('button')!.removeAttribute(TARGET_ATTRIBUTE)
    expect(inspectPage(mark(document.querySelector('h2')!))).toMatchObject({ components: ['App', 'Hero'], source: { line: 7 } })
  })

  it('takes a node Preact did not make for its nearest Preact element', () => {
    const extra = document.createElement('span')
    document.querySelector('h2')!.append(extra)
    expect(inspectPage(mark(extra))).toMatchObject({ components: ['App', 'Hero'], source: { line: 7 } })
  })

  it('finds nothing outside a Preact tree, or without the mark', () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="plain">Plain</p>')
    expect(inspectPage(mark(document.getElementById('plain')!))).toBeNull()
    expect(inspectPage('none')).toBeNull()
  })
})
