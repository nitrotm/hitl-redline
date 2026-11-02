import type { Rendered } from '@redline/shared'

// What the page's framework knows of a mark's element: run in the page itself (the background's
// scripting.executeScript, world MAIN), because the properties a framework puts on the DOM are the
// page's, which a content script does not see. The overlay marks the element with TARGET_ATTRIBUTE
// (attributes, both see) for the page to find it.

export const TARGET_ATTRIBUTE = 'data-redline-target'

// Run in the page, on its own: no import, no closure, it is sent as its source.
//
// Preact (10 and 11): a render() container holds its tree under __k; a vnode's DOM node is __e, its
// children __k; in a development build, jsxDEV puts where its JSX is on __source. The element's
// vnode is the one of a DOM tag whose node it is (or its nearest ancestor's, for a node Preact did
// not make), and the components are the vnodes of functions above it.
export function inspectPage(nonce: string): Rendered | null {
  type Source = { fileName?: string; lineNumber?: number; columnNumber?: number }
  type VNode = { type: unknown; __k?: (VNode | null)[] | null; __e?: Node | null; __source?: Source }

  const selector = `[data-redline-target="${nonce}"]`
  let element: Element | null = document.querySelector(selector)
  // in the frame of a device (the same origin)
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    if (element) break
    try {
      element = frame.contentDocument?.querySelector(selector) ?? null
    } catch {
      element = null
    }
  }
  if (!element) return null

  const isVNode = (v: unknown): v is VNode => typeof v === 'object' && v !== null && 'type' in v && '__e' in v
  let root: VNode | undefined
  let container: Node | null = element
  for (; container; container = container.parentNode) {
    const k = (container as unknown as { __k?: unknown }).__k
    if (isVNode(k)) {
      root = k
      break
    }
  }
  if (!root) return null

  const find = (vnode: VNode, node: Node, stack: VNode[]): VNode[] | null => {
    stack.push(vnode)
    if (typeof vnode.type === 'string' && vnode.__e === node) return stack.slice()
    for (const child of vnode.__k ?? []) {
      const found = child && find(child, node, stack)
      if (found) return found
    }
    stack.pop()
    return null
  }
  let stack: VNode[] | null = null
  for (let node: Node | null = element; node && node !== container && !stack; node = node.parentNode) stack = find(root, node, [])
  if (!stack) return null

  // a render() root is a Fragment, whatever a minified build named it: the others are skipped by it
  const fragment = root.type
  const names = stack
    .filter((v) => typeof v.type === 'function' && v.type !== fragment)
    .map((v) => {
      const type = v.type as { displayName?: string; name?: string }
      return type.displayName || type.name || ''
    })
    .filter(Boolean)
  const source = [...stack].reverse().find((v) => v.__source?.fileName)?.__source
  return {
    framework: 'preact',
    components: names,
    ...(source?.fileName && {
      source: { file: source.fileName, line: source.lineNumber ?? 0, ...(source.columnNumber !== undefined && { column: source.columnNumber }) },
    }),
  }
}
