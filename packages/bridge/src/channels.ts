import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { redlineHome } from './home.ts'

// A channel is an agent session's line to the browser: an adjective-pet name, unique among the
// user's channels, that stays the session's from round to round (the key: its agent session id,
// or the project). A tab is bound to one channel, and sends its rounds to it alone. The registry is
// a file per channel in the user's redline home, with the wait that listens for it, if one does.

export interface Channel {
  name: string
  // what the channel is for: `redline wait --session`, by default the project
  session: string
  project: string
  // the `redline wait` that listens for it
  pid?: number
  port?: number
  lastUsed: string
}

const ADJECTIVES = words(`
  brave bright bouncy breezy bubbly busy calm cheery chirpy clever cosy cuddly curious daring dapper dreamy eager fluffy fuzzy gentle giddy
  glad goofy happy humble jaunty jolly keen kind lively lucky mellow merry mighty nimble noble patient peppy perky plucky polite proud quick
  quiet quirky rosy sassy shy silly sleepy sly snug spry spunky sunny swift tidy tiny witty wise zesty bold snappy cheeky
`)

const PETS = words(`
  cat dog rabbit hamster gerbil mouse ferret chinchilla hedgehog parrot budgie canary finch cockatiel lovebird goldfish guppy betta koi tetra
  turtle tortoise gecko iguana chameleon axolotl newt frog snail pony donkey goat lamb piglet duck goose hen chick bunny kitten puppy collie
  poodle beagle corgi pug terrier spaniel husky dachshund tabby degu cavy skink lizard minnow dove pigeon quail alpaca llama cockatoo rat
  shrimp
`)

function words(text: string): string[] {
  return text.trim().split(/\s+/)
}

export const CHANNEL_NAME = /^[a-z]+-[a-z]+$/

export function drawName(random: () => number = Math.random): string {
  const pick = (words: string[]) => words[Math.floor(random() * words.length)]!
  return `${pick(ADJECTIVES)}-${pick(PETS)}`
}

// a channel unused this long, and with no wait, is forgotten: its name may come again
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

function channelsDir(): string {
  return join(redlineHome(), 'channels')
}

function channelFile(name: string): string {
  return join(channelsDir(), `${name}.json`)
}

// The channel of SESSION: the one it had, or a new name that no channel has (NAME: that one, if it
// is free or already SESSION's).
export async function claimChannel(options: { session: string; project: string; name?: string; draw?: () => string; now?: Date }): Promise<Channel> {
  const now = options.now ?? new Date()
  await mkdir(channelsDir(), { recursive: true, mode: 0o700 })
  const known = await listChannels(now)
  if (options.name !== undefined && !CHANNEL_NAME.test(options.name)) throw new Error(`invalid channel name: ${options.name} (adjective-pet, in lowercase)`)

  const mine = options.name !== undefined ? known.find((c) => c.name === options.name) : known.find((c) => c.session === options.session)
  if (mine) {
    if (mine.session !== options.session) throw new Error(`the channel ${mine.name} is taken, by ${mine.session}`)
    const used = { ...mine, project: options.project, lastUsed: now.toISOString() }
    await saveChannel(used)
    return used
  }

  // created exclusively: two waits that start at once never share a name
  const draw = options.draw ?? (() => drawName())
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = options.name ?? draw()
    const channel: Channel = { name, session: options.session, project: options.project, lastUsed: now.toISOString() }
    try {
      const file = await open(channelFile(name), 'wx', 0o600)
      await file.writeFile(`${JSON.stringify(channel, null, 2)}\n`)
      await file.close()
      return channel
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (options.name !== undefined) throw new Error(`the channel ${name} is taken`)
    }
  }
  throw new Error('no channel name is free: remove some of the files in ' + channelsDir())
}

// every channel, the forgotten ones removed
export async function listChannels(now = new Date()): Promise<Channel[]> {
  const names = await readdir(channelsDir()).catch(() => [] as string[])
  const channels: Channel[] = []
  for (const file of names.filter((n) => n.endsWith('.json'))) {
    const channel = await readFile(join(channelsDir(), file), 'utf8')
      .then((text) => JSON.parse(text) as Channel)
      .catch(() => undefined)
    if (!channel?.name || !channel.session) continue
    const stale = now.getTime() - Date.parse(channel.lastUsed) > EXPIRY_MS && !(channel.pid && isAlive(channel.pid))
    if (stale) await unlink(join(channelsDir(), file)).catch(() => undefined)
    else channels.push(channel)
  }
  return channels
}

// the wait listening for the channel, now
export async function recordWait(channel: Channel, pid: number, port: number): Promise<Channel> {
  const next = { ...channel, pid, port, lastUsed: new Date().toISOString() }
  await saveChannel(next)
  return next
}

// that wait gone; unless another took over meanwhile
export async function clearWait(name: string, pid: number) {
  const current = await readFile(channelFile(name), 'utf8')
    .then((text) => JSON.parse(text) as Channel)
    .catch(() => undefined)
  if (!current || current.pid !== pid) return
  const { pid: _, port: __, ...rest } = current
  await saveChannel(rest)
}

// written whole, then moved over the old one: a reader never sees half of it
async function saveChannel(channel: Channel) {
  const file = channelFile(channel.name)
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(channel, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
