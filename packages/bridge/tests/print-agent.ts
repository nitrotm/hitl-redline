// for tests/agent.test.ts: the agent process this one finds above it
import { agentProcess } from '../src/agent.ts'

console.log(JSON.stringify(await agentProcess()))
