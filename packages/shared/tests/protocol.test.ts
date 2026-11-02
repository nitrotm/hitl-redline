import { describe, expect, it } from 'vitest'

import { isExtensionOrigin } from '../src/protocol.ts'

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
