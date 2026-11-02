import { type Session, upgradeSession } from './session.ts'

// The sessions, by tab, in storage.local: the background writes them (through update(), one change
// at a time), the overlay and the sidebar watch them.

const KEY = 'redline:sessions'

type Sessions = Record<string, Session>

export async function getSessions(): Promise<Sessions> {
  return upgrade((await browser.storage.local.get(KEY))[KEY] as Sessions | undefined)
}

// as this version reads them, whichever stored them
function upgrade(sessions: Sessions | undefined): Sessions {
  return Object.fromEntries(Object.entries(sessions ?? {}).map(([tabId, session]) => [tabId, upgradeSession(session)]))
}

export async function getSession(tabId: number): Promise<Session | undefined> {
  return (await getSessions())[tabId]
}

let queue: Promise<unknown> = Promise.resolve()

// Changes the session of a tab: CHANGE gets the current one and returns the next (undefined
// removes it), or throws to leave it as it was. Changes run one after the other, so that none
// overwrites another made meanwhile.
export function update<T = void>(
  tabId: number,
  change: (session: Session | undefined) => [Session | undefined, T] | Promise<[Session | undefined, T]>
): Promise<T> {
  const run = queue.then(async () => {
    const sessions = await getSessions()
    const [next, result] = await change(sessions[tabId])
    if (next) sessions[tabId] = next
    else delete sessions[tabId]
    await browser.storage.local.set({ [KEY]: sessions })
    return result
  })
  queue = run.catch(() => undefined)
  return run
}

export function watchSession(tabId: () => number | undefined, listener: (session: Session | undefined) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const id = tabId()
    if (area !== 'local' || !(KEY in changes) || id === undefined) return
    listener(upgrade(changes[KEY]!.newValue as Sessions | undefined)[id])
  }
  browser.storage.onChanged.addListener(onChanged)
  return () => browser.storage.onChanged.removeListener(onChanged)
}
