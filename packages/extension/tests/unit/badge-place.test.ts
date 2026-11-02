import { describe, expect, it } from 'vitest'

import { busyness, placeBadge } from '../../src/badge-place.ts'

const base = { color: '', comment: '' }
const bounds = { x: 0, y: 0, width: 1000, height: 800 }
const mark = { ...base, id: 1, kind: 'rect' as const, rect: { x: 200, y: 200, width: 100, height: 50 } }
// busy where a rectangle meets the area above the mark's left half: text there
const textAboveLeft = (r: { x: number; y: number; width: number; height: number }) => (r.x < 250 && r.y + r.height <= 200 ? 50 : 0)

describe('placeBadge', () => {
  it('takes the usual place, above the left corner, when nothing is there', () => {
    expect(placeBadge(mark, [], () => 0, bounds)).toEqual({ x: 200 - 12.5, y: 178 })
  })

  it('goes where it hides the least', () => {
    const at = placeBadge(mark, [], textAboveLeft, bounds)
    // above the right corner (a badge of two characters is 25 wide)
    expect(at).toEqual({ x: 300 - 12.5, y: 178 })
  })

  it('keeps off the other marks', () => {
    const other = { ...base, id: 2, kind: 'rect' as const, rect: { x: 180, y: 150, width: 60, height: 40 } }
    // the usual place would be on it: above the right corner instead
    expect(placeBadge(mark, [other], () => 0, bounds)).toEqual({ x: 300 - 12.5, y: 178 })
  })

  it('stays inside the screenshot', () => {
    const corner = { ...mark, rect: { x: 0, y: 0, width: 50, height: 50 } }
    const at = placeBadge(corner, [], () => 0, bounds)
    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.y).toBeGreaterThanOrEqual(0)
  })
})

describe('busyness', () => {
  // a 20×10 image: white, with black stripes on its right half
  const width = 20
  const height = 10
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 0; y < height; y++) for (let x = 10; x < width; x += 2) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
  const busy = busyness({ width, height, data } as ImageData, 1, { x: 0, y: 0 })

  it('is nothing on a plain background, much on stripes', () => {
    expect(busy({ x: 0, y: 0, width: 10, height: 10 })).toBe(0)
    expect(busy({ x: 10, y: 0, width: 10, height: 10 })).toBeGreaterThan(100)
  })
})
