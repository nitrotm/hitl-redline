import type { Device } from '../devices.ts'
import type { PreparedCapture } from '../messages.ts'

// The page shown as a device: in a frame of the device's size, over the page itself, scaled down
// to fit the window when it is bigger. The frame's media queries are the device's. It loads the
// page anew (the same URL): what the page itself holds in memory is not in it.

const MARGIN = 24
// room above the frame for the toolbar
const TOP = 60

export interface DeviceFrame {
  show(device: Device | undefined): void
  // the page in the frame, while a device is shown: for the marks' targets and the capture
  page(): { win: Window; doc: Document } | undefined
  prepare(): PreparedCapture | undefined
  destroy(): void
}

export function mountDeviceFrame(container: HTMLElement, win: Window): DeviceFrame {
  container.innerHTML = `<div class="screen"><iframe title="Redline device preview"></iframe></div><div class="device-label"></div>`
  const screen = container.querySelector<HTMLDivElement>('.screen')!
  const iframe = container.querySelector('iframe')!
  const label = container.querySelector<HTMLDivElement>('.device-label')!
  let device: Device | undefined
  let scale = 1

  function layout() {
    if (!device) return
    const room = { width: win.innerWidth - 2 * MARGIN, height: win.innerHeight - TOP - MARGIN }
    scale = Math.min(1, room.width / device.width, room.height / device.height)
    iframe.style.width = `${device.width}px`
    iframe.style.height = `${device.height}px`
    screen.style.transform = `scale(${scale})`
    screen.style.left = `${Math.round((win.innerWidth - device.width * scale) / 2)}px`
    screen.style.top = `${Math.round(TOP + (room.height - device.height * scale) / 2)}px`
    label.textContent = `${device.label} · ${device.width}×${device.height}${scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}`
    label.style.top = `${Math.round(TOP + (room.height + device.height * scale) / 2 + 4)}px`
  }

  // the backdrop does not scroll the page under it; the frame scrolls its own
  container.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })
  win.addEventListener('resize', layout)

  function page() {
    if (!device) return undefined
    try {
      const frameWin = iframe.contentWindow
      return frameWin?.document ? { win: frameWin as Window, doc: frameWin.document } : undefined
    } catch {
      // another origin, after a navigation in the frame: no targets
      return undefined
    }
  }

  return {
    show(next) {
      device = next
      container.hidden = !device
      // the page, once: a change of device resizes it, its media queries follow
      if (device && !iframe.getAttribute('src')) iframe.src = win.location.href
      layout()
    },
    page,
    prepare() {
      if (!device) return undefined
      const frame = page()
      const box = screen.getBoundingClientRect()
      return {
        viewport: {
          width: device.width,
          height: device.height,
          // the screenshot's pixels per CSS pixel of the device
          dpr: scale * win.devicePixelRatio,
          scrollX: frame?.win.scrollX ?? 0,
          scrollY: frame?.win.scrollY ?? 0,
        },
        url: frame?.win.location.href ?? win.location.href,
        title: frame?.doc.title ?? win.document.title,
        device: { label: device.label, crop: { x: box.x, y: box.y, width: box.width, height: box.height }, windowWidth: win.innerWidth },
      }
    },
    destroy() {
      win.removeEventListener('resize', layout)
    },
  }
}
