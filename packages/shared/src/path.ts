import type { PathStep } from './schema.ts'

// The path to an element, as the agent reads it: short steps (button.cta[1/2]), the same step one
// after the other once (div ×3), and the steps into a shadow root marked.

export function stepText(step: PathStep): string {
  let text = step.tag
  if (step.id) text += `#${step.id}`
  for (const c of step.classes ?? []) text += `.${c}`
  if (step.testId) text += `[testid=${step.testId}]`
  if (step.role) text += `[role=${step.role}]`
  if (step.label) text += `[label="${step.label}"]`
  if (step.nth && step.of) text += `[${step.nth}/${step.of}]`
  return step.shadow ? `${text} ::shadow` : text
}

export function pathText(steps: PathStep[]): string {
  const parts: string[] = []
  let last: string | undefined
  let count = 0
  const flush = () => {
    if (last !== undefined) parts.push(count > 1 ? `${last} ×${count}` : last)
  }
  for (const step of steps) {
    const text = stepText(step)
    if (text === last) count++
    else {
      flush()
      last = text
      count = 1
    }
  }
  flush()
  return parts.join(' > ')
}

// the steps the paths all begin with
export function commonPrefix(paths: PathStep[][]): PathStep[] {
  const [first, ...rest] = paths
  if (!first) return []
  let n = 0
  while (n < first.length && rest.every((p) => n < p.length && stepText(p[n]!) === stepText(first[n]!))) n++
  return first.slice(0, n)
}
