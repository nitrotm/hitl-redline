import { describe, expect, it } from 'vitest'

import { arrowPath, badgeFor, boundingBox, freehandPath, rectFromCorners, translate } from '../../src/geometry.ts'

const base = { id: 1, color: '', comment: '' }

describe('geometry', () => {
  it('makes a rectangle whichever way it is dragged', () => {
    expect(rectFromCorners({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({ x: 10, y: 40, width: 40, height: 60 })
  })

  it('bounds a freehand mark, and an arrow', () => {
    const mark = {
      ...base,
      kind: 'freehand' as const,
      points: [
        { x: 5, y: 9 },
        { x: 15, y: 3 },
        { x: 10, y: 20 },
      ],
    }
    expect(boundingBox(mark)).toEqual({ x: 5, y: 3, width: 10, height: 17 })
    expect(boundingBox(translate(mark, 10, -3))).toEqual({ x: 15, y: 0, width: 10, height: 17 })
    const arrow = { ...base, kind: 'arrow' as const, from: { x: 50, y: 10 }, to: { x: 10, y: 40 } }
    expect(boundingBox(translate(arrow, 1, 1))).toEqual({ x: 11, y: 11, width: 40, height: 30 })
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

  it('outlines an arrow, its tip where it points', () => {
    const d = arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 })
    expect(d).toMatch(/^M[\d.,-]+(L[\d.,-]+)+Z$/)
    expect(d).toContain('L100.0,0.0L')
    // shorter than its head: the head alone
    expect(arrowPath({ x: 0, y: 0 }, { x: 5, y: 0 }).split('L')).toHaveLength(3)
  })

  it('puts the badge above a mark, behind an arrow, inside the page', () => {
    const badge = badgeFor({ ...base, id: 12, kind: 'rect', rect: { x: 100, y: 100, width: 50, height: 50 } })
    expect(badge.label).toBe('#12')
    expect(badge.y + badge.height).toBeLessThanOrEqual(100)
    expect(badgeFor({ ...base, kind: 'rect', rect: { x: 0, y: 0, width: 5, height: 5 } })).toMatchObject({ x: 0, y: 0 })
    // an arrow pointing right: its badge left of the tail
    const behind = badgeFor({ ...base, kind: 'arrow', from: { x: 200, y: 100 }, to: { x: 300, y: 100 } })
    expect(behind.x + behind.width).toBeLessThan(200)
  })
})
