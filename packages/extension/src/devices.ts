// The sizes a page is shown at, to see its responsive layouts: CSS pixels, as the page's media
// queries see them. "This window" is the page itself; the others show it in a frame of their size,
// scaled down when the window is smaller (src/overlay/device-frame.ts).

export interface Device {
  id: string
  label: string
  width: number
  height: number
}

export const WINDOW = 'window'

export const DEVICES: Device[] = [
  { id: 'phone', label: 'Phone (iPhone 15)', width: 393, height: 852 },
  { id: 'tablet', label: 'Tablet (iPad Air)', width: 820, height: 1180 },
  // a 1920×1080 screen at 125%
  { id: 'laptop', label: 'Laptop 14″ FHD', width: 1536, height: 864 },
  // a 3840×2160 screen at 150%
  { id: 'desktop', label: 'Desktop 4K', width: 2560, height: 1440 },
]

export function deviceOf(id: string | undefined): Device | undefined {
  return DEVICES.find((d) => d.id === id)
}
