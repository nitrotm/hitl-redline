import { describe, expect, it } from 'vitest'

import { aim } from '../src/geometry.ts'
import { type Bridge, Status, bridgeForSession, importToken, isExtensionOrigin, isUnder, mac, safeEqual } from '../src/protocol.ts'

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

describe('bridgeForSession', () => {
  const at = (port: number, channel: string, url?: string, startedAt = '2026-11-03T10:00:00.000Z'): Bridge => ({
    port,
    status: { app: 'redline', channel, project: `/p${port}`, pid: port, startedAt, nonce: 'n'.repeat(32), ...(url && { url }) },
  })
  const none = new Set<string>()

  it("takes a bridge of the tab's app, not another project's", () => {
    const bridges = [at(47390, 'brave-cat', 'http://localhost:5173/'), at(47391, 'calm-dog', 'http://localhost:3000/')]
    expect(bridgeForSession(bridges, 'http://localhost:3000/settings', undefined, none)?.port).toBe(47391)
    expect(bridgeForSession(bridges, 'http://localhost:8080/', undefined, none)).toBeUndefined()
  })

  it('takes any page of the app, the deepest preview the page is under first', () => {
    const bridges = [at(47390, 'brave-cat', 'http://localhost:5173/app/admin/'), at(47391, 'calm-dog', 'http://localhost:5173/app/')]
    // a sign-in page, outside both previews, is still the app's
    expect(bridgeForSession(bridges, 'http://localhost:5173/signin', undefined, none)).toBeDefined()
    expect(bridgeForSession(bridges, 'http://localhost:5173/app/admin/users', undefined, none)?.port).toBe(47390)
    expect(bridgeForSession(bridges, 'http://localhost:5173/app/home', undefined, none)?.port).toBe(47391)
  })

  it('binds an unbound tab to the newest channel no other tab holds', () => {
    const older = at(47390, 'brave-cat', 'http://localhost:5173/', '2026-11-03T10:00:00.000Z')
    const newer = at(47391, 'calm-dog', 'http://localhost:5173/', '2026-11-03T10:05:00.000Z')
    expect(bridgeForSession([older, newer], 'http://localhost:5173/', undefined, none)?.port).toBe(47391)
    expect(bridgeForSession([older, newer], 'http://localhost:5173/', undefined, new Set(['calm-dog']))?.port).toBe(47390)
    // all held: the likeliest, for a second tab of the same Claude
    expect(bridgeForSession([older, newer], 'http://localhost:5173/', undefined, new Set(['calm-dog', 'brave-cat']))?.port).toBe(47391)
  })

  it('sends a bound tab to its channel alone, wherever it waits, and to no other while it is away', () => {
    const bridges = [at(47390, 'brave-cat', 'http://localhost:5173/'), at(47391, 'calm-dog', 'http://localhost:5173/other/')]
    expect(bridgeForSession(bridges, 'http://localhost:5173/', 'calm-dog', none)?.port).toBe(47391)
    expect(bridgeForSession([bridges[0]!], 'http://localhost:5173/', 'calm-dog', none)).toBeUndefined()
  })

  it('falls back to a bridge waiting for any page', () => {
    expect(bridgeForSession([at(47390, 'brave-cat', 'http://localhost:5173/'), at(47392, 'calm-dog')], 'http://localhost:8080/', undefined, none)?.port).toBe(
      47392
    )
  })
})

describe('the MACs', () => {
  it('are HMAC-SHA256 of the parts, in hex', async () => {
    // RFC 4231, test case 2
    const key = await importToken('Jefe')
    expect(await mac(key, 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    expect(await mac(key, 'what do ya want', 'for nothing?')).not.toBe(await mac(key, 'what do ya want for nothing?'))
  })

  it('compare equal strings only', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'ab')).toBe(false)
  })
})

describe('Status', () => {
  const status = { app: 'redline', channel: 'brave-cat', project: '/p', pid: 1, startedAt: '2026-11-03T10:00:00.000Z', nonce: 'n'.repeat(32) }

  it('takes an http(s) preview and an extension base URL only', () => {
    expect(Status.safeParse({ ...status, url: 'http://localhost:5173/', extension: 'moz-extension://0f1e2d3c/' }).success).toBe(true)
    expect(Status.safeParse({ ...status, url: 'javascript:alert(1)' }).success).toBe(false)
    expect(Status.safeParse({ ...status, extension: 'https://evil.example/' }).success).toBe(false)
  })
})
