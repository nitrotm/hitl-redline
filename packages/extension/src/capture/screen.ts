// A frame of the window or the screen the user shares, for what the tab's own capture leaves out:
// the browser's popups, an open dropdown among them. Asked in the key's event, which
// getDisplayMedia needs, so before anything is awaited; then COUNTDOWN seconds to open the popup,
// told by TICK, and HIDE takes what the overlay shows off the page before the frame. The
// background finds the page in it (fromScreen).

const COUNTDOWN = 3
// for the frame after HIDE: the shared window's frames come later than the page's
const SETTLE_MS = 300

export async function grabScreen(win: Window, tick: (left: number) => void, hide: () => void): Promise<string> {
  // the browser's window or a screen; Chrome's tab would leave the popup out, as the tab's capture does
  const options = { video: { displaySurface: 'window' }, audio: false, selfBrowserSurface: 'exclude' } as DisplayMediaStreamOptions
  const stream = await win.navigator.mediaDevices.getDisplayMedia(options)
  const video = win.document.createElement('video')
  try {
    video.muted = true
    video.srcObject = stream
    await video.play()
    for (let left = COUNTDOWN; left > 0; left--) {
      tick(left)
      await sleep(1000)
    }
    hide()
    await sleep(SETTLE_MS)
    // A canvas of the page's, read as a string: Firefox's content scripts see the page's objects
    // through Xrays, and a blob's ArrayBuffer does not come through them.
    const canvas = win.document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
