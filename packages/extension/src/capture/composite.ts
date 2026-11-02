import type { Annotation, Viewport } from '@redline/shared'

import { RECT_STROKE, badgeFor, fillPath } from '../geometry.ts'

// The annotated screenshot: the clean one, with the marks and their #id badges drawn on it as the
// overlay draws them. Canvas without a document (OffscreenCanvas, createImageBitmap), so that it
// runs in Chrome's service worker as in Firefox's background page.

export async function composite(cleanPng: string, annotations: Annotation[], viewport: Viewport): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(cleanPng)).blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  // the screenshot's pixels per CSS pixel: the device pixel ratio, with the page's zoom
  const scale = canvas.width / viewport.width
  ctx.setTransform(scale, 0, 0, scale, -viewport.scrollX * scale, -viewport.scrollY * scale)
  for (const annotation of annotations) drawShape(ctx, annotation)
  for (const annotation of annotations) drawBadge(ctx, annotation)

  return pngDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
}

function drawShape(ctx: OffscreenCanvasRenderingContext2D, annotation: Annotation) {
  ctx.save()
  if (annotation.kind === 'rect') {
    const { x, y, width, height } = annotation.rect
    ctx.lineWidth = RECT_STROKE
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.strokeRect(x - 1, y - 1, width + 2, height + 2)
    ctx.strokeStyle = annotation.color
    ctx.strokeRect(x, y, width, height)
  } else {
    ctx.fillStyle = annotation.color
    ctx.fill(new Path2D(fillPath(annotation)))
  }
  ctx.restore()
}

function drawBadge(ctx: OffscreenCanvasRenderingContext2D, annotation: Annotation) {
  const badge = badgeFor(annotation)
  ctx.save()
  ctx.fillStyle = annotation.color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${badge.fontSize}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(badge.label, badge.x + badge.width / 2, badge.y + badge.height / 2 + 0.5)
  ctx.restore()
}

// A part of a screenshot of the window, given in the window's CSS pixels: the screenshot is
// WINDOW_WIDTH of them wide.
export async function crop(png: string, rect: { x: number; y: number; width: number; height: number }, windowWidth: number): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(png)).blob())
  const scale = bitmap.width / windowWidth
  const [x, y, width, height] = [rect.x, rect.y, rect.width, rect.height].map((v) => Math.round(v * scale)) as [number, number, number, number]
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.drawImage(bitmap, x, y, width, height, 0, 0, width, height)
  bitmap.close()
  return pngDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
}

async function pngDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}
