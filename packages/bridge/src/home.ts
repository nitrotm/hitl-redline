import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// What redline keeps that is the user's alone, in a directory only they read: the token the
// extension and the bridges prove they know, the channels of the agent sessions, the native
// messaging host. REDLINE_HOME moves it (the tests, a container that mounts the host's).

export function redlineHome(): string {
  if (process.env.REDLINE_HOME) return process.env.REDLINE_HOME
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'redline')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'redline')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'redline')
}

export async function ensureHome(): Promise<string> {
  const dir = redlineHome()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function tokenPath(): string {
  return join(redlineHome(), 'token')
}

// The token, made on first use: 32 random bytes. Whoever reads it can send the agent a round, so
// it is the user's only (Windows: %APPDATA% is).
export async function readOrCreateToken(): Promise<string> {
  await ensureHome()
  const file = tokenPath()
  for (let attempt = 0; attempt < 50; attempt++) {
    const token = await readFile(file, 'utf8').then(
      (text) => text.trim(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    )
    if (token) {
      await keepPrivate(file)
      return token
    }
    if (token === undefined) {
      const fresh = randomBytes(32).toString('base64url')
      try {
        await writeFile(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' })
        return fresh
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    // another redline is writing it: read it once written
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`${file} is empty: remove it, and a new token is made`)
}

// a token copied in with a wider mode, made the user's again
async function keepPrivate(file: string) {
  if (process.platform === 'win32') return
  if (((await stat(file)).mode & 0o077) !== 0) await chmod(file, 0o600)
}
