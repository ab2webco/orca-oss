import { describe, expect, it } from 'vitest'
import { teamFlowPhaseOf } from './team-flow-phase'

const working = (toolName: string | null, toolInput?: string) => ({
  state: 'working' as const,
  toolName,
  ...(toolInput ? { toolInput } : {})
})

// Why (ORCA-1205): every working member that was not editing read "Planning", tests and questions included.
describe('teamFlowPhaseOf', () => {
  it('reads tests while a member runs a test command', () => {
    for (const command of [
      'npx vitest run --config config/vitest.config.ts src/a.test.ts',
      'pnpm test',
      'npm test -- --run',
      'pnpm exec playwright test tests/e2e/a.spec.ts',
      'pytest -q',
      'go test ./...',
      'cargo test'
    ]) {
      expect(teamFlowPhaseOf(working('Bash', command))).toBe('tests')
    }
  })

  it('names no phase while a member waits on a question or a permission prompt', () => {
    expect(teamFlowPhaseOf({ state: 'waiting', toolName: 'AskUserQuestion' })).toBeNull()
    expect(
      teamFlowPhaseOf({ state: 'waiting', toolName: 'Bash', toolInput: 'pnpm test' })
    ).toBeNull()
  })

  it('names no phase for work it cannot place, instead of Planning', () => {
    expect(teamFlowPhaseOf(working('Read', 'src/a.ts'))).toBeNull()
    expect(teamFlowPhaseOf(working('Bash', 'git status'))).toBeNull()
    expect(teamFlowPhaseOf(working(null))).toBeNull()
  })

  it('reads code, tests or docs from the file an edit touches', () => {
    expect(teamFlowPhaseOf(working('Edit', 'src/shared/team-flow-phase.ts'))).toBe('code')
    expect(teamFlowPhaseOf(working('Write', 'src/shared/team-flow-phase.test.ts'))).toBe('tests')
    expect(teamFlowPhaseOf(working('Edit', 'tests/e2e/team-panel.spec.ts'))).toBe('tests')
    expect(teamFlowPhaseOf(working('Edit', 'docs/reference/working-process.md'))).toBe('docs')
    expect(teamFlowPhaseOf(working('Edit'))).toBe('code')
  })

  it('reads planning only from the planning tools', () => {
    expect(teamFlowPhaseOf(working('EnterPlanMode'))).toBe('plan')
    expect(teamFlowPhaseOf(working('TodoWrite'))).toBe('plan')
  })

  it('keeps the PR and merge phases from the review and ticket', () => {
    expect(teamFlowPhaseOf({ ...working('Read'), review: { state: 'open' } })).toBe('pr')
    expect(teamFlowPhaseOf({ ...working('Bash', 'pnpm test'), review: { state: 'open' } })).toBe(
      'tests'
    )
    expect(teamFlowPhaseOf({ state: 'done', toolName: null, review: { state: 'merged' } })).toBe(
      'merge'
    )
    expect(teamFlowPhaseOf({ state: 'idle', toolName: null })).toBeNull()
  })
})
