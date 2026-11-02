import type { Annotation, Point, Rect } from './schema.ts'

export function boundingBox(annotation: Annotation): Rect {
  if (annotation.kind === 'rect') return annotation.rect
  if (annotation.kind === 'arrow') return boundsOf([annotation.from, annotation.to])
  return boundsOf(annotation.strokes.flat())
}

export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

// what a mark points at: an arrow's tip, the center of the others
export function aim(annotation: Annotation): Point {
  if (annotation.kind === 'arrow') return annotation.to
  const box = boundingBox(annotation)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
