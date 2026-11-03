import type { PathStep, Target } from '@redline/shared'

// The element under a mark, named so the agent can find it in the sources: a CSS selector short
// enough to read, unique in the document when it can be, the start of its text, and its whole
// path from under <body>.

const MAX_TEXT = 80
const MAX_DEPTH = 5
const MAX_LABEL = 40
// a path deeper than this keeps its last steps
const MAX_PATH = 40

// the element at a point of the window, but IGNORE (the overlay), down into open shadow roots
export function elementAt(doc: Document, clientX: number, clientY: number, ignore: Element): Element | undefined {
  let element = doc.elementsFromPoint(clientX, clientY).find((el) => el !== ignore && !ignore.contains(el) && el !== doc.documentElement && el !== doc.body)
  if (!element) return undefined
  // into the open shadow roots, down to the element itself
  for (
    let inner = element.shadowRoot?.elementsFromPoint(clientX, clientY)[0];
    inner && inner !== element;
    inner = inner.shadowRoot?.elementsFromPoint(clientX, clientY)[0]
  )
    element = inner
  return element
}

export function describe(element: Element): Target {
  return {
    selector: cssSelector(element),
    tag: element.tagName.toLowerCase(),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT),
    path: domPath(element),
  }
}

// The steps from under <body> down to ELEMENT, through the shadow roots it is in.
export function domPath(element: Element): PathStep[] {
  const steps: PathStep[] = []
  let el: Element | null = element
  while (el && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement && steps.length < MAX_PATH) {
    const parent: Element | null = el.parentElement
    if (parent) {
      steps.unshift(pathStep(el, parent.children))
      el = parent
    } else {
      // the top of a shadow root: its host, the path going on in it (by its shape: in the device's
      // frame, ShadowRoot is the frame's, not this window's)
      const root = el.getRootNode() as ShadowRoot | Document
      const shadow = 'host' in root ? root : undefined
      steps.unshift(pathStep(el, shadow ? shadow.children : el.ownerDocument.children))
      el = shadow ? shadow.host : null
      if (el) steps.unshift({ ...pathStep(el, el.parentElement?.children ?? el.ownerDocument.children), shadow: true })
      el = el?.parentElement ?? null
    }
  }
  return steps
}

function pathStep(el: Element, siblings: HTMLCollection): PathStep {
  const step: PathStep = { tag: el.tagName.toLowerCase() }
  if (el.id) step.id = el.id
  const classes = meaningfulClasses(el)
  if (classes.length) step.classes = classes
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy')
  if (testId) step.testId = testId
  const role = el.getAttribute('role')
  if (role) step.role = role
  const label = el.getAttribute('aria-label')
  if (label) step.label = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
  const alike = [...siblings].filter((s) => s.tagName === el.tagName)
  if (alike.length > 1) {
    step.nth = alike.indexOf(el) + 1
    step.of = alike.length
  }
  return step
}

// the first two classes that read like names, not generated hashes
function meaningfulClasses(el: Element): string[] {
  return [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !/\d{3,}|^css-|^sc-|^jsx-/.test(c)).slice(0, 2)
}

export function cssSelector(element: Element): string {
  const doc = element.ownerDocument
  const parts: string[] = []
  for (let el: Element | null = element; el && el !== doc.documentElement && parts.length < MAX_DEPTH; el = el.parentElement) {
    if (el.id && isUnique(doc, `#${CSS.escape(el.id)}`)) {
      parts.unshift(`#${CSS.escape(el.id)}`)
      break
    }
    parts.unshift(step(el))
    if (isUnique(doc, parts.join(' > '))) break
  }
  return parts.join(' > ')
}

// a tag, its first classes that read like names (not generated hashes), and its rank among
// its siblings of the same tag when it needs one
function step(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const classes = meaningfulClasses(el)
  let selector = tag + classes.map((c) => `.${CSS.escape(c)}`).join('')
  const parent = el.parentElement
  if (parent) {
    const alike = [...parent.children].filter((sibling) => sibling.matches(selector))
    if (alike.length > 1) selector += `:nth-of-type(${[...parent.children].filter((s) => s.tagName === el.tagName).indexOf(el) + 1})`
  }
  return selector
}

function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}
