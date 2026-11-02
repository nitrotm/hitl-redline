import { getStroke } from 'perfect-freehand'

import { type Annotation, type Point, type Rect, boundingBox, boundsOf } from '@redline/shared'

// Shapes and their badges, the same on the page (SVG, src/overlay) and on the screenshot
// (canvas, src/capture): both draw the paths below, in page coordinates.

export const COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#16a34a'] as const
export const RECT_STROKE = 3
export const FREEHAND_SIZE = 6
export const BADGE_HEIGHT = 20
const BADGE_FONT_SIZE = 12

export { boundingBox, boundsOf }

// a rectangle from two corners, whichever way it was dragged
export function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function translate(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'rect') return { ...annotation, rect: { ...annotation.rect, x: annotation.rect.x + dx, y: annotation.rect.y + dy } }
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

export interface Badge {
  x: number
  y: number
  width: number
  height: number
  label: string
  fontSize: number
}

// The badge sits outside the top left corner of the shape, where it hides the least of what the
// mark points at; inside the page when the shape touches its edge.
export function badgeFor(annotation: Annotation): Badge {
  const label = `#${annotation.id}`
  const width = Math.round(10 + label.length * 7.5)
  const anchor = annotation.kind === 'rect' ? { x: annotation.rect.x, y: annotation.rect.y } : (annotation.points[0] ?? { x: 0, y: 0 })
  return {
    x: Math.max(0, anchor.x - width / 2),
    y: Math.max(0, anchor.y - BADGE_HEIGHT - 2),
    width,
    height: BADGE_HEIGHT,
    label,
    fontSize: BADGE_FONT_SIZE,
  }
}
