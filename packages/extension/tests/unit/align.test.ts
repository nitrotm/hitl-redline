import { describe, expect, it } from 'vitest'

import { type Gray, grayOf, locate, shrink } from '../../src/capture/align.ts'

// a page: blocks of text-like stripes on white, the same for a given seed
function page(width: number, height: number, seed = 1): Gray {
  const data = new Uint8Array(width * height).fill(255)
  let s = seed
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(random() * (width - 80))
    const y = Math.floor(random() * (height - 20))
    const w = 20 + Math.floor(random() * 60)
    const shade = Math.floor(random() * 200)
    for (let yy = y; yy < y + 12; yy += 3) for (let xx = x; xx < x + w; xx++) data[yy * width + xx] = shade
  }
  return { width, height, data }
}

// the window: gray around the page, at X, Y, each page pixel SCALE frame pixels wide
function windowWith(reference: Gray, x: number, y: number, width: number, height: number, scale = 1): Gray {
  const data = new Uint8Array(width * height).fill(60)
  for (let v = 0; v < Math.round(reference.height * scale); v++)
    for (let u = 0; u < Math.round(reference.width * scale); u++)
      data[(y + v) * width + x + u] = reference.data[Math.floor(v / scale) * reference.width + Math.floor(u / scale)]!
  return { width, height, data }
}

describe('locate', () => {
  it('finds the page in the window, under the browser', () => {
    const reference = page(400, 300)
    expect(locate(windowWith(reference, 37, 91, 520, 420), reference)).toMatchObject({ x: 37, y: 91, scale: 1 })
  })

  it('finds it under an open dropdown, which the reference has not', () => {
    const reference = page(400, 300)
    const frame = windowWith(reference, 12, 70, 480, 400)
    // the list, over a fifth of the page, and out of it below
    for (let y = 150; y < 400; y++) for (let x = 60; x < 160; x++) frame.data[y * frame.width + x] = y % 20 < 10 ? 240 : 30
    expect(locate(frame, reference)).toMatchObject({ x: 12, y: 70, scale: 1 })
  })

  it('finds it on a display scaled twice', () => {
    const reference = page(300, 200)
    expect(locate(windowWith(reference, 40, 120, 720, 600, 2), reference)).toMatchObject({ x: 40, y: 120, scale: 2 })
  })

  it('finds nothing in a window without the page', () => {
    expect(locate(page(500, 400, 7), page(400, 300, 3))).toBeUndefined()
  })

  it('finds nothing in a frame smaller than the page', () => {
    expect(locate(page(100, 100), page(400, 300))).toBeUndefined()
  })
})

describe('shrink', () => {
  it('averages the pixels under each', () => {
    const image = { width: 4, height: 2, data: Uint8Array.from([0, 100, 200, 200, 100, 200, 0, 0]) }
    expect(Array.from(shrink(image, 2, 1).data)).toEqual([100, 100])
  })
})

describe('grayOf', () => {
  it('weighs green the most', () => {
    expect(Array.from(grayOf(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1).data)).toEqual([76, 149, 28])
  })
})
