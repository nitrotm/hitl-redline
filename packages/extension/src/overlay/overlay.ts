import type { Annotation, Point, Snapshot } from '@redline/shared'

import { deviceOf, deviceOptions } from '../devices.ts'
import { COLORS, COLOR_KEYS, aim, arrowPath, badgeFor, boundingBox, fillPath, freehandPath, rectFromCorners, translate } from '../geometry.ts'
import { type ContentRequest, type NewAnnotation, type PreparedCapture, send } from '../messages.ts'
import { type Session, type Tool, currentSnapshot } from '../state/session.ts'
import { targetAt } from '../target-hint.ts'
import { mountDeviceFrame } from './device-frame.ts'
import { OVERLAY_CSS } from './style.ts'

// The overlay, in a shadow root that the page's styles cannot reach. On the live page, it is a
// toolbar whose first button takes a screenshot. Once taken, the screenshot covers the page,
// frozen, and the marks go on it: an SVG whose coordinates are the screenshot's, moved by its
// scroll, so a mark is stored in page coordinates. What is drawn goes to the background, and
// comes back through storage.

const SVG = 'http://www.w3.org/2000/svg'
const MIN_SIZE = 4
// an arrow shorter than this is a slip
const MIN_ARROW = 12
// how far from a mark's box a double click still hits it
const HIT = 6
// by the keys' places (KeyboardEvent.code), whatever the layout: the tools on 1 to 4, the colors
// on the row under them (COLOR_KEYS)
const TOOL_KEYS: Record<string, Tool> = { Digit1: 'select', Digit2: 'rect', Digit3: 'arrow', Digit4: 'freehand' }
const SAVE_MS = 300
// the id of a mark drawn, until the background gives it its own
const NEW = 0

export interface Overlay {
  render(session: Session): void
  handle(request: ContentRequest): Promise<unknown> | undefined
  destroy(): void
}

export function viewportOf(win: Window): PreparedCapture {
  return {
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio, scrollX: win.scrollX, scrollY: win.scrollY },
    url: win.location.href,
    title: win.document.title,
  }
}

export function mountOverlay(doc: Document, initial: Session): Overlay {
  const host = doc.createElement('redline-overlay')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
  // open, for the end-to-end tests to reach the toolbar; the page's styles stop at its edge all the same
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${OVERLAY_CSS}</style>
    <div class="device" hidden></div>
    <div class="frozen" hidden>
      <svg class="canvas" xmlns="${SVG}" preserveAspectRatio="xMidYMid meet">
        <image class="screenshot" preserveAspectRatio="none"></image>
        <g class="world"><g class="shapes"></g><g class="preview"></g></g>
      </svg>
    </div>
    <div class="toolbar live">
      <span class="grip" title="Move the toolbar">${ICONS.grip}</span>
      <select class="device-select" title="Show the page as a device">${deviceOptions(initial.device)}</select>
      <button data-action="capture" class="capture" title="Take a screenshot to annotate (Ctrl+S)">${ICONS.camera}<span class="label">Screenshot</span></button>
      <span class="annotating">
        <span class="sep"></span>
        <button data-tool="select" title="Select and move (1)">${ICONS.select}</button>
        <button data-tool="rect" title="Rectangle (2)">${ICONS.rect}</button>
        <button data-tool="arrow" title="Arrow: from where it starts to what it points at (3)">${ICONS.arrow}</button>
        <button data-tool="freehand" title="Pen (4)">${ICONS.pen}</button>
        <span class="sep"></span>
        ${COLORS.map((c, i) => `<button class="swatch" data-color="${c}" title="Color (${COLOR_KEYS[i]!.slice(3)})" style="--c:${c}"></button>`).join('')}
        <span class="sep"></span>
        <button data-action="undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button data-action="delete" title="Delete the selected mark (Del)">${ICONS.trash}</button>
        <span class="sep"></span>
        <span class="snapshot-id"></span>
        <button data-action="close" title="Back to the page">${ICONS.close}</button>
      </span>
    </div>
    <div class="popover" hidden>
      <span class="badge"></span>
      <textarea rows="2" placeholder="What should change here? Enter to save, Esc to close"></textarea>
      <button class="trash" title="Delete this mark">${ICONS.trash}</button>
    </div>
    <div class="toast" hidden></div>`
  doc.documentElement.append(host)

  const frozen = root.querySelector<HTMLDivElement>('.frozen')!
  const svg = root.querySelector<SVGSVGElement>('svg')!
  const image = root.querySelector<SVGImageElement>('.screenshot')!
  const world = root.querySelector<SVGGElement>('.world')!
  const shapes = root.querySelector<SVGGElement>('.shapes')!
  const preview = root.querySelector<SVGGElement>('.preview')!
  const toolbar = root.querySelector<HTMLDivElement>('.toolbar')!
  const popover = root.querySelector<HTMLDivElement>('.popover')!
  const comment = popover.querySelector('textarea')!
  const toast = root.querySelector<HTMLDivElement>('.toast')!
  const win = doc.defaultView!
  const deviceFrame = mountDeviceFrame(root.querySelector<HTMLDivElement>('.device')!, win)
  const deviceSelect = root.querySelector<HTMLSelectElement>('.device-select')!
  deviceSelect.addEventListener('change', () => void send({ type: 'ui/set', device: deviceSelect.value }).catch(report))

  let session = initial
  let snapshot: Snapshot | undefined
  let shownImage: string | undefined
  // the session's (session.selected), shared with the sidebar; set here at once, for the drag
  let selected: number | null = null
  let highlighted: number | null = null
  // the mark being drawn or moved, before it goes to the background
  let gesture:
    | { kind: 'rect'; from: Point; to: Point }
    | { kind: 'arrow'; from: Point; to: Point }
    | { kind: 'freehand'; points: Point[] }
    | { kind: 'move'; id: number; from: Point; dx: number; dy: number }
    | null = null
  // the mark whose comment the popover edits: NEW, a mark drawn whose id has not come yet
  let editing: number | null = null
  // what was typed for a NEW mark, closed before its id came
  let unsaved: string | undefined
  // a NEW mark deleted before its id came: deleted once it comes
  let deleteOnAdd = false

  // a pointer's position, in the page's coordinates of the snapshot: the screenshot's, scaled to
  // the window, plus the scroll it was taken at
  function page(e: PointerEvent | MouseEvent): Point {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x + snapshot!.viewport.scrollX, y: p.y + snapshot!.viewport.scrollY }
  }

  // the other way: where a point of the page is in the window, the screenshot shown
  function client(p: Point): Point {
    const q = new DOMPoint(p.x - snapshot!.viewport.scrollX, p.y - snapshot!.viewport.scrollY).matrixTransform(svg.getScreenCTM()!)
    return { x: q.x, y: q.y }
  }

  function render(next: Session) {
    session = next
    snapshot = currentSnapshot(session)
    const marks = snapshot?.annotations ?? []
    if (!gesture) selected = session.selected ?? null
    if (editing !== null && editing !== NEW && !marks.some((a) => a.id === editing)) closePopover(false)

    toolbar.classList.toggle('live', !snapshot)
    deviceFrame.show(deviceOf(session.device))
    deviceSelect.value = session.device
    frozen.hidden = !snapshot
    if (snapshot) {
      const { width, height, scrollX, scrollY } = snapshot.viewport
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      image.setAttribute('width', String(width))
      image.setAttribute('height', String(height))
      world.setAttribute('transform', `translate(${-scrollX} ${-scrollY})`)
      root.querySelector('.snapshot-id')!.textContent = snapshot.id
      if (shownImage !== snapshot.id) loadImage(snapshot.id)
    } else shownImage = undefined
    svg.dataset.tool = session.tool
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('on', button.dataset.tool === session.tool)
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-color]')) button.classList.toggle('on', button.dataset.color === session.color)
    toolbar.querySelector<HTMLButtonElement>('[data-action="delete"]')!.disabled = selected === null
    toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = marks.length === 0
    drawShapes()
  }

  function loadImage(snapshotId: string) {
    shownImage = snapshotId
    image.removeAttribute('href')
    send({ type: 'snapshot/image', snapshotId }).then((png) => {
      if (shownImage === snapshotId) image.setAttribute('href', png)
    }, report)
  }

  function drawShapes() {
    shapes.replaceChildren(
      ...(snapshot?.annotations ?? []).map((annotation) => {
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
    } else if (gesture?.kind === 'arrow') {
      preview.append(el('path', { d: arrowPath(gesture.from, gesture.to), class: 'stroke', fill: session.color }))
    } else if (gesture?.kind === 'freehand') {
      preview.append(el('path', { d: freehandPath(gesture.points), class: 'stroke', fill: session.color }))
    }
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !snapshot) return
    if (editing !== null) closePopover(true)
    const shape = (e.target as Element).closest<SVGGElement>('[data-id]')
    if (session.tool === 'select') {
      selected = shape ? Number(shape.dataset.id) : null
      if (selected !== null) gesture = { kind: 'move', id: selected, from: page(e), dx: 0, dy: 0 }
      if (selected !== (session.selected ?? null)) void send({ type: 'annotation/select', id: selected }).catch(report)
      drawShapes()
      if (!gesture) return
    } else if (session.tool === 'rect' || session.tool === 'arrow') {
      gesture = session.tool === 'rect' ? { kind: 'rect', from: page(e), to: page(e) } : { kind: 'arrow', from: page(e), to: page(e) }
    } else {
      gesture = { kind: 'freehand', points: [page(e)] }
    }
    svg.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  svg.addEventListener('pointermove', (e) => {
    if (!gesture) return
    const p = page(e)
    if (gesture.kind === 'rect' || gesture.kind === 'arrow') gesture.to = p
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
    if (!done || !snapshot) return

    if (done.kind === 'move') {
      const annotation = snapshot.annotations.find((a) => a.id === done.id)
      if (!annotation || Math.hypot(done.dx, done.dy) < 1) return drawShapes()
      const moved = translate(annotation, done.dx, done.dy)
      const patch = moved.kind === 'rect' ? { rect: moved.rect } : moved.kind === 'arrow' ? { from: moved.from, to: moved.to } : { points: moved.points }
      // until the background's answer comes back through storage, it stays where it was dropped
      snapshot = { ...snapshot, annotations: snapshot.annotations.map((a) => (a.id === done.id ? moved : a)) }
      drawShapes()
      void send({ type: 'annotation/update', id: done.id, patch: { ...patch, target: targetOf(moved) } }).catch(report)
      return
    }

    let annotation: NewAnnotation
    if (done.kind === 'rect') {
      const rect = rectFromCorners(done.from, done.to)
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return
      annotation = { kind: 'rect', color: session.color, rect }
    } else if (done.kind === 'arrow') {
      if (Math.hypot(done.to.x - done.from.x, done.to.y - done.from.y) < MIN_ARROW) return
      annotation = { kind: 'arrow', color: session.color, from: done.from, to: done.to }
    } else {
      if (done.points.length < 2) return
      annotation = { kind: 'freehand', color: session.color, points: done.points }
    }
    const drawn = { ...annotation, id: NEW, comment: '' } as Annotation
    const target = targetOf(drawn)
    // drawn at once, and its comment open at once, to type into: its id comes from the background
    shapes.append(shapeElement(drawn, { selected: false, highlighted: false }))
    openPopover(drawn)
    send({ type: 'annotation/add', annotation: target ? { ...annotation, target } : annotation }).then((added) => {
      if (deleteOnAdd) {
        deleteOnAdd = false
        unsaved = undefined
        void send({ type: 'annotation/delete', id: added.id }).catch(report)
        return
      }
      if (editing === NEW) {
        editing = added.id
        popover.querySelector<HTMLSpanElement>('.badge')!.textContent = `#${added.id}`
        if (comment.value) saveComment()
      } else if (unsaved !== undefined) {
        // its comment was typed and closed before the id came
        void send({ type: 'annotation/update', id: added.id, patch: { comment: unsaved } }).catch(report)
      }
      unsaved = undefined
    }, report)
  })

  svg.addEventListener('pointercancel', () => {
    gesture = null
    preview.replaceChildren()
    drawShapes()
  })

  // A double click edits a mark's comment, whatever the tool: the mark under the pointer, or,
  // marks not taking the pointer while a drawing tool is on, the last drawn whose box, or badge,
  // is there (a double click draws nothing: too small).
  svg.addEventListener('dblclick', (e) => {
    if (!snapshot) return
    const shape = (e.target as Element).closest<SVGGElement>('[data-id]')
    const p = page(e)
    const within = (box: { x: number; y: number; width: number; height: number }) =>
      p.x >= box.x - HIT && p.x <= box.x + box.width + HIT && p.y >= box.y - HIT && p.y <= box.y + box.height + HIT
    const near = (a: Annotation) => within(boundingBox(a)) || within(badgeFor(a))
    const annotation = shape ? snapshot.annotations.find((a) => a.id === Number(shape.dataset.id)) : snapshot.annotations.findLast(near)
    if (annotation) openPopover(annotation, true)
  })

  // the screenshot does not scroll: the page under it must not either
  frozen.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })

  // The element the mark points at (aim: an arrow's tip, the others' center), on the live page under
  // the screenshot: the same, as long as the page has not changed since.
  function targetOf(annotation: Annotation) {
    const c = aim(annotation)
    // shown as a device, the page is the frame's
    const live = deviceOf(session.device) ? deviceFrame.page() : { win, doc }
    return live && targetAt(live.doc, c.x - live.win.scrollX, c.y - live.win.scrollY, host)
  }

  // the comment of a mark, where it is, at once: Enter saves, Esc closes, Shift+Enter is a new line
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  // SELECT: all of the comment, to type over it
  function openPopover(annotation: Annotation, select = false) {
    if (!snapshot) return
    editing = annotation.id
    const badge = popover.querySelector<HTMLSpanElement>('.badge')!
    badge.textContent = annotation.id === NEW ? '#…' : `#${annotation.id}`
    badge.style.background = annotation.color
    comment.value = annotation.comment
    popover.hidden = false
    const box = boundingBox(annotation)
    const below = client({ x: box.x, y: box.y + box.height })
    const above = client({ x: box.x, y: box.y })
    const height = popover.offsetHeight
    const top = below.y + 8 + height < win.innerHeight ? below.y + 8 : Math.max(8, above.y - height - 8)
    popover.style.left = `${Math.min(Math.max(8, below.x), win.innerWidth - popover.offsetWidth - 8)}px`
    popover.style.top = `${top}px`
    comment.focus()
    if (select) comment.select()
  }

  function closePopover(save: boolean) {
    clearTimeout(saveTimer)
    if (save) saveComment()
    editing = null
    popover.hidden = true
    // the keys go to the tools again
    comment.blur()
  }

  function saveComment() {
    if (editing === NEW) {
      unsaved = comment.value
      return
    }
    const annotation = snapshot?.annotations.find((a) => a.id === editing)
    if (editing !== null && comment.value !== annotation?.comment)
      void send({ type: 'annotation/update', id: editing, patch: { comment: comment.value } }).catch(report)
  }

  // the mark, deleted from its comment box; the box keeps the focus until the click is done
  const trash = popover.querySelector<HTMLButtonElement>('.trash')!
  trash.addEventListener('pointerdown', (e) => e.preventDefault())
  trash.addEventListener('click', () => {
    const id = editing
    closePopover(false)
    if (id === NEW) deleteOnAdd = true
    else if (id !== null) void send({ type: 'annotation/delete', id }).catch(report)
  })

  comment.addEventListener('input', () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveComment, SAVE_MS)
  })
  comment.addEventListener('keydown', (e) => {
    // the page's shortcuts never see what is typed here
    e.stopPropagation()
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
      e.preventDefault()
      closePopover(true)
    }
  })
  comment.addEventListener('blur', () => {
    if (editing !== null) closePopover(true)
  })

  toolbar.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button')
    if (!button) return
    if (button.dataset.tool) setTool(button.dataset.tool as Tool)
    else if (button.dataset.color) setColor(button.dataset.color)
    else act(button.dataset.action)
  })

  function setTool(tool: Tool) {
    if (snapshot) void send({ type: 'ui/set', tool }).catch(report)
  }

  function setColor(color: string) {
    if (!snapshot) return
    void send({ type: 'ui/set', color }).catch(report)
    // the selected mark takes it too
    if (selected !== null) void send({ type: 'annotation/update', id: selected, patch: { color } }).catch(report)
  }

  function act(action: string | undefined) {
    if (action === 'capture') capture()
    else if (!snapshot) return
    else if (action === 'undo') void send({ type: 'annotation/undo' }).catch(report)
    else if (action === 'delete' && selected !== null) void send({ type: 'annotation/delete', id: selected }).catch(report)
    else if (action === 'close') void send({ type: 'snapshot/close' }).catch(report)
  }

  function capture() {
    if (editing !== null) closePopover(true)
    void send({ type: 'snapshot/capture' }).then((r) => notify(`${r.snapshotId}: draw on the screenshot, then comment each mark; Ctrl+S for another`), report)
  }

  function onKey(e: KeyboardEvent) {
    if (e.altKey || e.metaKey) return
    // a new screenshot, from wherever the focus is: Ctrl+S, the browser's Save Page otherwise, which
    // yields to the page that takes it (S by its letter: a screenshot, on any layout)
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      e.stopPropagation()
      return capture()
    }
    const target = e.composedPath()[0] as HTMLElement | undefined
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    const key = e.key.toLowerCase()
    const color = COLOR_KEYS.indexOf(e.code as (typeof COLOR_KEYS)[number])
    let handled = true
    if (!snapshot) handled = false
    else if (e.ctrlKey && key === 'z') act('undo')
    else if (e.ctrlKey) handled = false
    else if (e.code in TOOL_KEYS && !e.shiftKey) setTool(TOOL_KEYS[e.code]!)
    else if (color >= 0 && !e.shiftKey) setColor(COLORS[color]!)
    else if (key === 'escape') setTool('select')
    else if ((key === 'delete' || key === 'backspace') && selected !== null) act('delete')
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // the toolbar moves by its grip, out of the way of what is to be marked
  const grip = toolbar.querySelector<HTMLSpanElement>('.grip')!
  grip.addEventListener('pointerdown', (e) => {
    const start = { x: e.clientX, y: e.clientY, rect: toolbar.getBoundingClientRect() }
    grip.setPointerCapture(e.pointerId)
    const move = (m: PointerEvent) => {
      toolbar.style.left = `${Math.min(Math.max(0, start.rect.left + m.clientX - start.x), win.innerWidth - start.rect.width)}px`
      toolbar.style.top = `${Math.min(Math.max(0, start.rect.top + m.clientY - start.y), win.innerHeight - start.rect.height)}px`
      toolbar.style.right = 'auto'
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    e.preventDefault()
  })

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function notify(message: string, error = false) {
    toast.textContent = message
    toast.classList.toggle('error', error)
    toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.hidden = true), error ? 6000 : 3000)
  }
  function report(error: unknown) {
    notify(error instanceof Error ? error.message : String(error), true)
  }

  win.addEventListener('keydown', onKey, true)
  render(session)

  return {
    render,
    handle(request) {
      switch (request.type) {
        case 'capture/prepare': {
          // shown as a device, all but its frame hides
          const device = deviceFrame.prepare()
          if (device) {
            host.classList.add('capturing')
            return new Promise<PreparedCapture>((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve(device))))
          }
          host.style.visibility = 'hidden'
          // two frames: the one without the overlay is painted before the capture
          return new Promise<PreparedCapture>((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve(viewportOf(win)))))
        }
        case 'capture/restore':
          host.style.visibility = ''
          host.classList.remove('capturing')
          return Promise.resolve(null)
        case 'highlight':
          highlighted = request.id
          drawShapes()
          return Promise.resolve(null)
        case 'ping':
          return Promise.resolve('pong')
      }
    },
    destroy() {
      deviceFrame.destroy()
      win.removeEventListener('keydown', onKey, true)
      host.remove()
    },
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
    const d = fillPath(annotation)
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
  grip: icon(
    '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'
  ),
  camera: icon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  select: icon('<path d="M5 3l14 8-6 2-3 6z"/>'),
  rect: icon('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
  arrow: icon('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'),
  pen: icon('<path d="M4 20c4-1 6-5 9-9s5-6 7-6"/><path d="M16 4l4 4"/>'),
  undo: icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
}
