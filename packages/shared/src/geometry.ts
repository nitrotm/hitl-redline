import type { Annotation, Point, Rect } from './schema.ts'

export function boundingBox(annotation: Annotation): Rect {
  if (annotation.kind === 'rect') return annotation.rect
  return boundsOf(annotation.points)
}

export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
