// The release's version, written in every file that carries one: `node scripts/version.mjs` checks
// that they agree and prints it; `node scripts/version.mjs 1.2.0` writes it in all of them.
// nix/workspace.nix reads the bridge's package.json, and WXT the extension's, for its manifest.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const files = [
  'packages/bridge/package.json',
  'packages/extension/package.json',
  'packages/pi/package.json',
  'packages/shared/package.json',
  'claude/.claude-plugin/plugin.json',
]
// The first "version" of each file is the file's own: the others are its dependencies'.
const field = /^(\s*"version":\s*")([^"]*)(")/m

const version = process.argv[2]
if (version === undefined) {
  const found = files.map((file) => [file, readFileSync(join(root, file), 'utf8').match(field)?.[2]])
  const versions = new Set(found.map(([, v]) => v))
  if (versions.size !== 1 || versions.has(undefined)) {
    for (const [file, v] of found) process.stderr.write(`${file}: ${v ?? 'no version'}\n`)
    process.stderr.write('version: the files disagree; set one with `yarn bump X.Y.Z`\n')
    process.exit(1)
  }
  process.stdout.write(`${found[0][1]}\n`)
} else {
  // X.Y.Z only: a browser's manifest takes numbers, not a pre-release's suffix.
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write(`version: X.Y.Z, not ${version}\n`)
    process.exit(1)
  }
  for (const file of files) {
    const path = join(root, file)
    writeFileSync(path, readFileSync(path, 'utf8').replace(field, `$1${version}$3`))
  }
  process.stdout.write(`${version}\n`)
}
