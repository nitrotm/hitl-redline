import type { Annotation, Point } from '@redline/shared'

import { COLORS, badgeFor, boundingBox, center, freehandPath, rectFromCorners, translate } from '../geometry.ts'
import { type ContentRequest, type NewAnnotation, type PreparedCapture, send } from '../messages.ts'
import type { Session, Tool } from '../state/session.ts'
import { targetAt } from '../target-hint.ts'
import { OVERLAY_CSS } from './style.ts'

// The marks on the page: an SVG the size of the viewport, over everything, in a shadow
// root that the page's styles cannot reach. Its shapes are in page coordinates, moved by the
// scroll, so a mark stays on what it marks. What it draws is the session's drafts; what is drawn
// goes to the background, and comes back through storage.

const SVG = 'http://www.w3.org/2000/svg'
const MIN_SIZE = 4

export interface Overlay {
  render(session: Session): void
  handle(request: ContentRequest): Promise<unknown> | undefined
  destroy(): void
}

export function mountOverlay(doc: Document, initial: Session): Overlay {
  const host = doc.createElement('redline-overlay')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
  // open, for the end-to-end tests to reach the toolbar; the page's styles stop at its edge all the same
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${OVERLAY_CSS}</style>
    <svg class="canvas" xmlns="${SVG}"><g class="world"><g class="shapes"></g><g class="preview"></g></g></svg>
    <div class="toolbar" part="toolbar">
      <button data-tool="select" title="Select and move (V)">${ICONS.select}</button>
      <button data-tool="rect" title="Rectangle (R)">${ICONS.rect}</button>
      <button data-tool="freehand" title="Pen (P)">${ICONS.pen}</button>
      <span class="sep"></span>
      ${COLORS.map((c) => `<button class="swatch" data-color="${c}" title="Color" style="--c:${c}"></button>`).join('')}
      <span class="sep"></span>
      <button data-action="undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
      <button data-action="delete" title="Delete the selected mark (Del)">${ICONS.trash}</button>
      <button data-action="capture" title="Capture a snapshot (C)">${ICONS.camera}</button>
      <span class="sep"></span>
      <button data-action="stop" title="Hide Redline (Alt+Shift+R)">${ICONS.close}</button>
    </div>
    <div class="toast" hidden></div>`
  doc.documentElement.append(host)

  const svg = root.querySelector('svg')!
  const world = root.querySelector<SVGGElement>('.world')!
  const shapes = root.querySelector<SVGGElement>('.shapes')!
  const preview = root.querySelector<SVGGElement>('.preview')!
  const toolbar = root.querySelector<HTMLDivElement>('.toolbar')!
  const toast = root.querySelector<HTMLDivElement>('.toast')!
  const win = doc.defaultView!

  let session = initial
  let selected: number | null = null
  let highlighted: number | null = null
  // the mark being drawn or moved, before it goes to the background
  let gesture:
    | { kind: 'rect'; from: Point; to: Point }
    | { kind: 'freehand'; points: Point[] }
    | { kind: 'move'; id: number; from: Point; dx: number; dy: number }
    | null = null

  const page = (e: PointerEvent): Point => ({ x: e.clientX + win.scrollX, y: e.clientY + win.scrollY })

  function render(next: Session) {
    session = next
    if (selected !== null && !session.draft.some((a) => a.id === selected)) selected = null
    svg.classList.toggle('drawing', session.tool !== 'select')
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('on', button.dataset.tool === session.tool)
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-color]')) button.classList.toggle('on', button.dataset.color === session.color)
    toolbar.querySelector<HTMLButtonElement>('[data-action="delete"]')!.disabled = selected === null
    toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = session.draft.length === 0
    drawShapes()
  }

  function drawShapes() {
    shapes.replaceChildren(
      ...session.draft.map((annotation) => {
        const moved = gesture?.kind === 'move' && gesture.id === annotation.id ? translate(annotation, gesture.dx, gesture.dy) : annotation
        return shapeElement(moved, { selected: annotation.id === selected, highlighted: annotation.id === highlighted })
      })
    )
  }

  function drawPreview() {
    preview.replaceChildren()
    if (gesture?.kind === 'rect') {
      const r = rectFromCorners(gesture.from, gesture.to)
      preview.append(el('rect', { x: r.x, y: r.y, width: r.width, height: r.height, class: 'rect', stroke: session.color }))
    } else if (gesture?.kind === 'freehand') {
      preview.append(el('path', { d: freehandPath(gesture.points), class: 'stroke', fill: session.color }))
    }
  }

  function follow() {
    world.setAttribute('transform', `translate(${-win.scrollX} ${-win.scrollY})`)
  }

  // drawing: on the SVG, which takes the pointer when a drawing tool is on
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const shape = (e.target as Element).closest<SVGGElement>('[data-id]')
    if (session.tool === 'select') {
      if (!shape) return
      const id = Number(shape.dataset.id)
      selected = id
      gesture = { kind: 'move', id, from: page(e), dx: 0, dy: 0 }
      render(session)
    } else if (session.tool === 'rect') {
      gesture = { kind: 'rect', from: page(e), to: page(e) }
    } else {
      gesture = { kind: 'freehand', points: [page(e)] }
    }
    svg.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  })

  svg.addEventListener('pointermove', (e) => {
    if (!gesture) return
    const p = page(e)
    if (gesture.kind === 'rect') gesture.to = p
    else if (gesture.kind === 'freehand') {
      const last = gesture.points.at(-1)!
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) gesture.points.push(p)
    } else {
      gesture.dx = p.x - gesture.from.x
      gesture.dy = p.y - gesture.from.y
      drawShapes()
      return
    }
    drawPreview()
  })

  svg.addEventListener('pointerup', (e) => {
    const done = gesture
    gesture = null
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId)
    preview.replaceChildren()
    if (!done) return

    if (done.kind === 'move') {
      const annotation = session.draft.find((a) => a.id === done.id)
      if (!annotation || Math.hypot(done.dx, done.dy) < 1) return drawShapes()
      const moved = translate(annotation, done.dx, done.dy)
      const patch = moved.kind === 'rect' ? { rect: moved.rect } : { points: moved.points }
      // until the background's answer comes back through storage, it stays where it was dropped
      render({ ...session, draft: session.draft.map((a) => (a.id === done.id ? moved : a)) })
      void send({ type: 'annotation/update', id: done.id, patch: { ...patch, target: targetOf(moved) } }).catch(report)
      return
    }

    let annotation: NewAnnotation
    if (done.kind === 'rect') {
      const rect = rectFromCorners(done.from, done.to)
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return
      annotation = { kind: 'rect', color: session.color, rect }
    } else {
      if (done.points.length < 2) return
      annotation = { kind: 'freehand', color: session.color, points: done.points }
    }
    const target = targetOf({ ...annotation, id: 0, comment: '' } as Annotation)
    // drawn at once, without its id until the background gives it one
    shapes.append(shapeElement({ ...annotation, id: 0, comment: '' } as Annotation, { selected: false, highlighted: false }))
    void send({ type: 'annotation/add', annotation: target ? { ...annotation, target } : annotation }).catch(report)
  })

  svg.addEventListener('pointercancel', () => {
    gesture = null
    preview.replaceChildren()
    drawShapes()
  })

  // the element under the mark's center, the overlay out of the way
  function targetOf(annotation: Annotation) {
    const c = center(boundingBox(annotation))
    return targetAt(doc, c.x - win.scrollX, c.y - win.scrollY, host)
  }

  toolbar.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button')
    if (!button) return
    if (button.dataset.tool) setTool(button.dataset.tool as Tool)
    else if (button.dataset.color) void send({ type: 'ui/set', color: button.dataset.color }).catch(report)
    else act(button.dataset.action)
  })

  function setTool(tool: Tool) {
    void send({ type: 'ui/set', tool }).catch(report)
  }

  function act(action: string | undefined) {
    if (action === 'undo') void send({ type: 'annotation/undo' }).catch(report)
    else if (action === 'delete' && selected !== null) void send({ type: 'annotation/delete', id: selected }).catch(report)
    else if (action === 'capture') capture()
    else if (action === 'stop') void send({ type: 'session/stop' }).catch(report)
  }

  function capture() {
    void send({ type: 'snapshot/capture' }).then(
      (r) =>
        notify(`${r.snapshotId}: ${r.captured} mark${r.captured === 1 ? '' : 's'} captured${r.left ? `, ${r.left} outside the view left on the page` : ''}`),
      report
    )
  }

  function onKey(e: KeyboardEvent) {
    const target = e.composedPath()[0] as HTMLElement | undefined
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (e.altKey || e.metaKey) return
    const key = e.key.toLowerCase()
    let handled = true
    if ((e.ctrlKey && key === 'z') || (!e.ctrlKey && key === 'u')) act('undo')
    else if (e.ctrlKey) handled = false
    else if (key === 'escape' || key === 'v') setTool('select')
    else if (key === 'r') setTool('rect')
    else if (key === 'p') setTool('freehand')
    else if (key === 'c') capture()
    else if ((key === 'delete' || key === 'backspace') && selected !== null) act('delete')
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  function notify(message: string, error = false) {
    toast.textContent = message
    toast.classList.toggle('error', error)
    toast.hidden = false
    clearTimeout(timer)
    timer = setTimeout(() => (toast.hidden = true), error ? 6000 : 3000)
  }
  function report(error: unknown) {
    notify(error instanceof Error ? error.message : String(error), true)
  }

  win.addEventListener('scroll', follow, { passive: true })
  win.addEventListener('keydown', onKey, true)
  follow()
  render(session)

  return {
    render,
    handle(request) {
      switch (request.type) {
        case 'capture/prepare':
          host.style.visibility = 'hidden'
          // two frames: the one without the overlay is painted before the capture
          return new Promise<PreparedCapture>((resolve) =>
            win.requestAnimationFrame(() =>
              win.requestAnimationFrame(() =>
                resolve({
                  viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio, scrollX: win.scrollX, scrollY: win.scrollY },
                  url: doc.location.href,
                  title: doc.title,
                })
              )
            )
          )
        case 'capture/restore':
          host.style.visibility = ''
          return Promise.resolve(null)
        case 'highlight':
          highlighted = request.id
          drawShapes()
          if (request.id !== null) scrollIntoView(request.id)
          return Promise.resolve(null)
        case 'ping':
          return Promise.resolve('pong')
      }
    },
    destroy() {
      win.removeEventListener('scroll', follow)
      win.removeEventListener('keydown', onKey, true)
      host.remove()
    },
  }

  function scrollIntoView(id: number) {
    const annotation = session.draft.find((a) => a.id === id)
    if (!annotation) return
    const box = boundingBox(annotation)
    const inView =
      box.y + box.height > win.scrollY && box.y < win.scrollY + win.innerHeight && box.x + box.width > win.scrollX && box.x < win.scrollX + win.innerWidth
    if (!inView) win.scrollTo({ left: Math.max(0, box.x - 40), top: Math.max(0, box.y - win.innerHeight / 3), behavior: 'smooth' })
  }
}

function shapeElement(annotation: Annotation, state: { selected: boolean; highlighted: boolean }): SVGGElement {
  const g = el('g', { class: `mark${state.selected ? ' selected' : ''}${state.highlighted ? ' highlighted' : ''}`, 'data-id': annotation.id })
  if (annotation.kind === 'rect') {
    const { x, y, width, height } = annotation.rect
    g.append(
      el('rect', { x, y, width, height, class: 'hit' }),
      el('rect', { x: x - 1, y: y - 1, width: width + 2, height: height + 2, class: 'halo' }),
      el('rect', { x, y, width, height, class: 'rect', stroke: annotation.color })
    )
  } else {
    const d = freehandPath(annotation.points)
    g.append(el('path', { d, class: 'hit' }), el('path', { d, class: 'stroke', fill: annotation.color }))
  }
  if (annotation.id > 0) {
    const badge = badgeFor(annotation)
    g.append(
      el('rect', { x: badge.x, y: badge.y, width: badge.width, height: badge.height, rx: badge.height / 2, class: 'badge', fill: annotation.color }),
      Object.assign(el('text', { x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 + 0.5, class: 'label', 'font-size': badge.fontSize }), {
        textContent: badge.label,
      })
    )
  }
  return g
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  return element
}

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICONS = {
  select: icon('<path d="M5 3l14 8-6 2-3 6z"/>'),
  rect: icon('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
  pen: icon('<path d="M4 20c4-1 6-5 9-9s5-6 7-6"/><path d="M16 4l4 4"/>'),
  undo: icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  camera: icon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
}
