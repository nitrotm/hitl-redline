import { describe, expect, it } from 'vitest'

import { badgeFor, boundingBox, freehandPath, intersects, rectFromCorners, translate } from '../../src/geometry.ts'

describe('geometry', () => {
  it('makes a rectangle whichever way it is dragged', () => {
    expect(rectFromCorners({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({ x: 10, y: 40, width: 40, height: 60 })
  })

  it('bounds a freehand mark', () => {
    const mark = {
      id: 1,
      kind: 'freehand' as const,
      color: '',
      comment: '',
      points: [
        { x: 5, y: 9 },
        { x: 15, y: 3 },
        { x: 10, y: 20 },
      ],
    }
    expect(boundingBox(mark)).toEqual({ x: 5, y: 3, width: 10, height: 17 })
    expect(boundingBox(translate(mark, 10, -3))).toEqual({ x: 15, y: 0, width: 10, height: 17 })
  })

  it('tells when rectangles overlap', () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
  })

  it('outlines a stroke as a closed path', () => {
    expect(
      freehandPath([
        { x: 0, y: 0 },
        { x: 20, y: 10 },
        { x: 40, y: 0 },
      ])
    ).toMatch(/^M[\d.,-]+(L[\d.,-]+)+Z$/)
  })

  it('puts the badge above the mark, inside the page', () => {
    const badge = badgeFor({ id: 12, kind: 'rect', color: '', comment: '', rect: { x: 100, y: 100, width: 50, height: 50 } })
    expect(badge.label).toBe('#12')
    expect(badge.y + badge.height).toBeLessThanOrEqual(100)
    expect(badgeFor({ id: 1, kind: 'rect', color: '', comment: '', rect: { x: 0, y: 0, width: 5, height: 5 } })).toMatchObject({ x: 0, y: 0 })
  })
})
