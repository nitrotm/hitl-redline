import type { Target } from '@redline/shared'

// The element under a mark, named so Claude can find it in the sources: a CSS selector short
// enough to read, unique in the document when it can be, and the start of its text.

const MAX_TEXT = 80
const MAX_DEPTH = 5

export function targetAt(doc: Document, clientX: number, clientY: number, ignore: Element): Target | undefined {
  const element = doc.elementsFromPoint(clientX, clientY).find((el) => el !== ignore && !ignore.contains(el) && el !== doc.documentElement && el !== doc.body)
  if (!element) return undefined
  return {
    selector: cssSelector(element),
    tag: element.tagName.toLowerCase(),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT),
  }
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
  const classes = [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !/\d{3,}|^css-|^sc-|^jsx-/.test(c)).slice(0, 2)
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
