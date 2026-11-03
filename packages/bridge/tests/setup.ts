import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the token and the channels of the tests, never the user's
process.env.REDLINE_HOME = mkdtempSync(join(tmpdir(), 'redline-home-'))
// nor their Herdr: a wait run in its pane would name the agent there after the tests' channel
delete process.env.HERDR_PANE_ID
