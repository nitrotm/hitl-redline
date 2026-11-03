// Where the page is in a frame of the window or the screen the user shared (src/capture/screen.ts):
// the tab's own screenshot (the reference), found in it. The frame has what the tab's capture
// leaves out, the browser's popups (an open dropdown), which cover a part of the page: a pixel
// counts CAP at most, and the rest of the page decides. Grays only, without a canvas, to be tested.

export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

// the reference's top left corner in the frame, its pixels' size there, and how far the frame is
// from it (the mean of the capped differences)
export interface Placement {
  x: number
  y: number
  scale: number
  error: number
}

// the frame's pixels per reference pixel tried: the same device pixels, or a display scaled otherwise
const SCALES = [1, 2, 0.5, 1.25, 0.8, 1.5, 2 / 3]
const CAP = 32
// a place further than this from the reference is not the page: the popup covers too much of it, or
// the browser's window was not shared
const MAX_ERROR = 12
// the reference's width in the first search, a coarse one over the whole frame
const COARSE_WIDTH = 96
const COARSE_SAMPLES = 2048
const FINE_SAMPLES = 4096
// an edge: this much difference with the next pixel, right and down; looked for among this many
// times the pixels sampled, and enough of them to sample them only
const EDGE = 24
const EDGE_SPREAD = 8
const MIN_EDGES = 64

export function grayOf(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = (rgba[4 * i]! * 77 + rgba[4 * i + 1]! * 150 + rgba[4 * i + 2]! * 29) >> 8
  return { width, height, data }
}

// smaller: each pixel the mean of those under it
export function shrink(image: Gray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height)
  const fx = image.width / width
  const fy = image.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += image.data[yy * image.width + xx]!
      data[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { width, height, data }
}

export function locate(frame: Gray, reference: Gray): Placement | undefined {
  // coarse first, at each scale: both shrunk, every place of the reference in the frame
  let coarse: { x: number; y: number; scale: number; factor: number; error: number } | undefined
  for (const scale of SCALES) {
    const width = reference.width * scale
    const height = reference.height * scale
    if (width > frame.width + 1 || height > frame.height + 1) continue
    // the frame's pixels per coarse pixel
    const factor = Math.max(1, width / COARSE_WIDTH)
    const f = shrink(frame, Math.max(1, Math.round(frame.width / factor)), Math.max(1, Math.round(frame.height / factor)))
    const r = shrink(reference, Math.min(f.width, Math.max(1, Math.round(width / factor))), Math.min(f.height, Math.max(1, Math.round(height / factor))))
    const found = search(f, r, 1, [0, f.width - r.width], [0, f.height - r.height], COARSE_SAMPLES, coarse?.error)
    if (found && (!coarse || found.error < coarse.error)) coarse = { ...found, scale, factor }
  }
  if (!coarse) return undefined

  // then at full size, around the coarse place
  const { scale, factor } = coarse
  const reach = Math.ceil(factor) + 1
  const maxX = Math.floor(frame.width - reference.width * scale)
  const maxY = Math.floor(frame.height - reference.height * scale)
  const cx = Math.round(coarse.x * factor)
  const cy = Math.round(coarse.y * factor)
  const fine = search(
    frame,
    reference,
    scale,
    [Math.max(0, cx - reach), Math.max(0, Math.min(maxX, cx + reach))],
    [Math.max(0, cy - reach), Math.max(0, Math.min(maxY, cy + reach))],
    FINE_SAMPLES
  )
  return fine && fine.error <= MAX_ERROR ? { ...fine, scale } : undefined
}

// The place, from X0 to X1 and Y0 to Y1, where the reference's pixels, each SCALE frame pixels
// wide, differ the least from the frame's. A place stops being added up once worse than the best.
function search(
  frame: Gray,
  reference: Gray,
  scale: number,
  [x0, x1]: [number, number],
  [y0, y1]: [number, number],
  count: number,
  bound = Infinity
): { x: number; y: number; error: number } | undefined {
  if (x1 < x0 || y1 < y0) return undefined
  const points = samples(reference, count)
  const refs = points.map(([u, v]) => reference.data[v * reference.width + u]!)
  const offsets = points.map(
    ([u, v]) => Math.min(frame.height - 1 - y1, Math.round(v * scale)) * frame.width + Math.min(frame.width - 1 - x1, Math.round(u * scale))
  )
  let best: { x: number; y: number; error: number } | undefined
  let limit = bound * points.length
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const base = y * frame.width + x
      let sum = 0
      for (let i = 0; i < offsets.length && sum < limit; i++) sum += Math.min(CAP, Math.abs(frame.data[base + offsets[i]!]! - refs[i]!))
      if (sum < limit) {
        limit = sum
        best = { x, y, error: sum / points.length }
      }
    }
  }
  return best
}

// Up to COUNT of the image's pixels, spread over it, where something is: a page is mostly blank,
// and its blank parts would match any blank part of the frame. A page with too little on it is
// sampled all over.
function samples(image: Gray, count: number): [number, number][] {
  const step = Math.max(1, Math.sqrt((image.width * image.height) / (count * EDGE_SPREAD)))
  const all: [number, number][] = []
  const edges: [number, number][] = []
  for (let v = step / 2; v < image.height - 1; v += step)
    for (let u = step / 2; u < image.width - 1; u += step) {
      const [x, y] = [Math.floor(u), Math.floor(v)]
      const at = y * image.width + x
      all.push([x, y])
      if (Math.abs(image.data[at]! - image.data[at + 1]!) + Math.abs(image.data[at]! - image.data[at + image.width]!) >= EDGE) edges.push([x, y])
    }
  const points = edges.length >= MIN_EDGES ? edges : all
  if (!points.length) return [[0, 0]]
  const every = Math.max(1, points.length / count)
  return Array.from({ length: Math.min(count, points.length) }, (_, i) => points[Math.floor(i * every)]!)
}
