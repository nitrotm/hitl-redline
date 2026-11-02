import { getStroke } from 'perfect-freehand'

import { type Annotation, type Point, type Rect, boundingBox } from '@redline/shared'

// Shapes and their badges, the same on the page (SVG, src/overlay) and on the screenshot
// (canvas, src/capture): both draw the paths below, in page coordinates.

export const COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#16a34a'] as const
// the keys of the colors, in order: the row under the tools' 1, 2, 3, 4
export const COLOR_KEYS = ['q', 'w', 'e', 'r'] as const
export const RECT_STROKE = 3
export const FREEHAND_SIZE = 6
export const ARROW_SHAFT = 4
const ARROW_HEAD = { length: 16, width: 16 }
export const BADGE_HEIGHT = 20
const BADGE_FONT_SIZE = 12

export { aim, boundingBox, boundsOf } from '@redline/shared'

// a rectangle from two corners, whichever way it was dragged
export function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function translate(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'rect') return { ...annotation, rect: { ...annotation.rect, x: annotation.rect.x + dx, y: annotation.rect.y + dy } }
  if (annotation.kind === 'arrow')
    return { ...annotation, from: { x: annotation.from.x + dx, y: annotation.from.y + dy }, to: { x: annotation.to.x + dx, y: annotation.to.y + dy } }
  return { ...annotation, points: annotation.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

// the outline of a freehand stroke, as an SVG path (canvas draws it with Path2D)
export function freehandPath(points: Point[]): string {
  const outline = getStroke(
    points.map((p) => [p.x, p.y]),
    { size: FREEHAND_SIZE, thinning: 0.4, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last: true }
  )
  if (outline.length < 2) return ''
  const [first, ...rest] = outline as [number, number][]
  return `M${first![0].toFixed(1)},${first![1].toFixed(1)}` + rest.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z'
}

// The outline of an arrow, shaft and head, as one closed SVG path to fill, its tip on TO. Shorter
// than its head, it is the head alone.
export function arrowPath(from: Point, to: Point): string {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length < 1) return ''
  const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
  const n = { x: -u.y, y: u.x }
  const head = Math.min(ARROW_HEAD.length, length)
  const base = { x: to.x - u.x * head, y: to.y - u.y * head }
  const at = (p: Point, side: number) => `${(p.x + n.x * side).toFixed(1)},${(p.y + n.y * side).toFixed(1)}`
  const half = ARROW_SHAFT / 2
  const wing = ARROW_HEAD.width / 2
  const shaft = length > head ? [at(from, half), at(base, half)] : []
  const back = length > head ? [at(base, -half), at(from, -half)] : []
  return `M${[...shaft, at(base, wing), `${to.x.toFixed(1)},${to.y.toFixed(1)}`, at(base, -wing), ...back].join('L')}Z`
}

// the path of a filled mark: an arrow, or a freehand stroke (a rectangle is a stroked rect)
export function fillPath(annotation: Exclude<Annotation, { kind: 'rect' }>): string {
  return annotation.kind === 'arrow' ? arrowPath(annotation.from, annotation.to) : freehandPath(annotation.points)
}

export interface Badge {
  x: number
  y: number
  width: number
  height: number
  label: string
  fontSize: number
}

// The badge sits where it hides the least of what the mark points at: outside the top left corner
// of the shape's box, or behind an arrow's tail; inside the page when the shape touches its edge.
export function badgeFor(annotation: Annotation): Badge {
  const label = `#${annotation.id}`
  const width = Math.round(10 + label.length * 7.5)
  let center: Point
  if (annotation.kind === 'arrow') {
    const { from, to } = annotation
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    const away = width / 2 + 4
    center = { x: from.x - ((to.x - from.x) / length) * away, y: from.y - ((to.y - from.y) / length) * away }
  } else {
    const box = boundingBox(annotation)
    center = { x: box.x, y: box.y - BADGE_HEIGHT / 2 - 2 }
  }
  return {
    x: Math.max(0, center.x - width / 2),
    y: Math.max(0, center.y - BADGE_HEIGHT / 2),
    width,
    height: BADGE_HEIGHT,
    label,
    fontSize: BADGE_FONT_SIZE,
  }
}
