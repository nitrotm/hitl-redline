import { describe, expect, it } from 'vitest'

import { aim } from '../src/geometry.ts'
import { isExtensionOrigin, isUnder, pickBridge } from '../src/protocol.ts'

describe('isExtensionOrigin', () => {
  it('takes the origins of Firefox and Chrome extensions', () => {
    expect(isExtensionOrigin('moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b')).toBe(true)
    expect(isExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true)
  })

  it('refuses web pages, and look-alikes', () => {
    expect(isExtensionOrigin('http://localhost:5173')).toBe(false)
    expect(isExtensionOrigin('null')).toBe(false)
    expect(isExtensionOrigin('moz-extension://abc.evil.example')).toBe(false)
    expect(isExtensionOrigin('moz-extension://abc/path')).toBe(false)
  })
})

describe('isUnder', () => {
  it('takes the preview and the pages under it', () => {
    expect(isUnder('http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
    expect(isUnder('http://localhost:5173/settings?tab=2', 'http://localhost:5173/')).toBe(true)
    expect(isUnder('http://localhost:5173/app/users', 'http://localhost:5173/app/index.html')).toBe(true)
  })

  it('refuses another origin or another path', () => {
    expect(isUnder('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(isUnder('http://localhost:5173/other', 'http://localhost:5173/app/')).toBe(false)
    expect(isUnder('not a url', 'http://localhost:5173/')).toBe(false)
  })
})

describe('aim', () => {
  it('is the tip of an arrow, the center of the others', () => {
    const base = { id: 1, color: '', comment: '' }
    expect(aim({ ...base, kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 40, y: 10 } })).toEqual({ x: 40, y: 10 })
    expect(aim({ ...base, kind: 'rect', rect: { x: 10, y: 10, width: 20, height: 40 } })).toEqual({ x: 20, y: 30 })
  })
})

describe('pickBridge', () => {
  const at = (port: number, url?: string, replyTo?: string) => ({
    port,
    status: { app: 'redline' as const, project: `/p${port}`, pid: port, ...(url && { url }), ...(replyTo && { reply: { sessionId: replyTo, round: 1 } }) },
  })

  it("takes the bridge of the tab's preview, not another project's", () => {
    const bridges = [at(47390, 'http://localhost:5173/'), at(47391, 'http://localhost:3000/')]
    expect(pickBridge(bridges, 'http://localhost:3000/settings')?.port).toBe(47391)
    expect(pickBridge(bridges, 'http://localhost:8080/')).toBeUndefined()
  })

  it("prefers the one replying to the tab's session, and else one waiting for any page", () => {
    expect(pickBridge([at(47390, 'http://localhost:5173/'), at(47391, 'http://localhost:5173/', 's2')], 'http://localhost:5173/', 's2')?.port).toBe(47391)
    expect(pickBridge([at(47390, 'http://localhost:5173/'), at(47392)], 'http://localhost:8080/')?.port).toBe(47392)
  })
})
