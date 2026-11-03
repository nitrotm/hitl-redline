import { type Key, NATIVE_HOST, importToken } from '@redline/shared'

// The user's token, which every bridge checks and proves it knows (packages/shared/src/protocol.ts):
// from the native messaging host the browser runs as the user (`redline install`), or pasted in
// the sidebar where it cannot run (`redline token`). Kept in storage.local, which no page reads.

const KEY = 'redline:token'

// the host is asked again when a bridge refuses the token (made anew since), at most this often
const ASK_EVERY_MS = 15_000

let asked = 0
let cached: { token: string; key: Key } | undefined

export async function pairingKey(): Promise<Key | undefined> {
  const token = (await storedToken()) ?? (await fromHost())
  return token ? keyOf(token) : undefined
}

// A bridge refused the token: the host's, if it has another. Whether it does.
export async function renewToken(): Promise<boolean> {
  const before = await storedToken()
  const token = await fromHost()
  return token !== undefined && token !== before
}

export async function setToken(pasted: string): Promise<void> {
  const token = pasted.trim()
  if (!/^[\w-]{32,}$/.test(token)) throw new Error('not a token: paste what `redline token` prints')
  await browser.storage.local.set({ [KEY]: token })
}

async function storedToken(): Promise<string | undefined> {
  const token = (await browser.storage.local.get(KEY))[KEY]
  return typeof token === 'string' && token ? token : undefined
}

async function fromHost(): Promise<string | undefined> {
  if (Date.now() - asked < ASK_EVERY_MS) return undefined
  asked = Date.now()
  try {
    const reply = (await browser.runtime.sendNativeMessage(NATIVE_HOST, { type: 'token' })) as { token?: unknown } | undefined
    if (typeof reply?.token !== 'string' || !reply.token) return undefined
    await browser.storage.local.set({ [KEY]: reply.token })
    return reply.token
  } catch {
    // no host installed, or one the browser cannot run (a Snap or Flatpak without the portal)
    return undefined
  }
}

async function keyOf(token: string): Promise<Key> {
  if (cached?.token !== token) cached = { token, key: await importToken(token) }
  return cached.key
}
