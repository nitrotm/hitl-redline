import type { Annotation, Point, Rect } from '@redline/shared'

import { BADGE_HEIGHT, badgeFor, badgeWidth, boundingBox } from './geometry.ts'

// Where a mark's badge goes: of the places around the mark, the one that hides the least of the
// screenshot (BUSY: how much there is to see under a rectangle of the page) and no other mark. The
// first place is the usual one, and wins a tie.

// how much worse a place is for covering another mark, or for being further down the list
const OVERLAP = 1000
const RANK = 2
const GAP = 4

export type Busy = (rect: Rect) => number

export function placeBadge(annotation: Annotation, others: Annotation[], busy: Busy, bounds: Rect): Point {
  const width = badgeWidth(annotation.id)
  const taken = others.flatMap((a) => [boundingBox(a), badgeFor(a)])
  let best: { at: Point; score: number } | undefined
  places(annotation, width).forEach((at, rank) => {
    const rect = { x: at.x, y: at.y, width, height: BADGE_HEIGHT }
    if (!inside(rect, bounds)) return
    const score = busy(rect) + RANK * rank + OVERLAP * taken.filter((r) => overlaps(r, rect)).length
    if (!best || score < best.score) best = { at, score }
  })
  // nowhere inside the screenshot: the usual place, as badgeFor puts it
  return best?.at ?? { x: badgeFor(annotation).x, y: badgeFor(annotation).y }
}

// the top left corners of the places, the usual one first
function places(annotation: Annotation, width: number): Point[] {
  const h = BADGE_HEIGHT
  if (annotation.kind === 'arrow') {
    const { from, to } = annotation
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
    const n = { x: -u.y, y: u.x }
    const away = width / 2 + GAP
    const centered = (c: Point) => ({ x: c.x - width / 2, y: c.y - h / 2 })
    return [
      centered({ x: from.x - u.x * away, y: from.y - u.y * away }),
      centered({ x: from.x + n.x * (h / 2 + GAP + 2), y: from.y + n.y * (h / 2 + GAP + 2) }),
      centered({ x: from.x - n.x * (h / 2 + GAP + 2), y: from.y - n.y * (h / 2 + GAP + 2) }),
    ]
  }
  const { x, y, width: w, height: hh } = boundingBox(annotation)
  return [
    { x: x - width / 2, y: y - h - 2 },
    { x: x + w - width / 2, y: y - h - 2 },
    { x: x - width / 2, y: y + hh + 2 },
    { x: x + w - width / 2, y: y + hh + 2 },
    { x: x - width - GAP, y },
    { x: x + w + GAP, y },
  ]
}

function inside(r: Rect, bounds: Rect): boolean {
  return r.x >= bounds.x && r.y >= bounds.y && r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

// How busy the pixels of an image are under a rectangle: the spread of their lightness, 0 for a
// plain background, high for text and edges. SCALE: the image's pixels per unit of the rectangle;
// ORIGIN: where the image's top left is, in the rectangle's units.
export function busyness(image: ImageData, scale: number, origin: Point): Busy {
  return (rect) => {
    const x0 = Math.max(0, Math.floor((rect.x - origin.x) * scale))
    const y0 = Math.max(0, Math.floor((rect.y - origin.y) * scale))
    const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width - origin.x) * scale))
    const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height - origin.y) * scale))
    const step = Math.max(1, Math.round(scale))
    let n = 0
    let sum = 0
    let squares = 0
    for (let y = y0; y < y1; y += step)
      for (let x = x0; x < x1; x += step) {
        const i = (y * image.width + x) * 4
        const lightness = 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!
        n++
        sum += lightness
        squares += lightness * lightness
      }
    if (n === 0) return 0
    const mean = sum / n
    return Math.sqrt(Math.max(0, squares / n - mean * mean))
  }
}
