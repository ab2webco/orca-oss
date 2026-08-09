import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
// Why: switch-account ships a hybrid discovery stub, so the version-sensitive command
// guidance lives in the authoritative guide source. The installable stub projection is
// asserted separately — it must route to the binary instead of listing flags.
const guidePath = join(projectDir, 'skill-guides', 'switch-account.md')
const stubPath = join(projectDir, 'skills', 'switch-account', 'SKILL.md')

describe('switch-account skill guidance', () => {
  it('delegates listing and switching to the two account commands, with no logic of its own', () => {
    const guide = readFileSync(guidePath, 'utf8')

    expect(guide).toContain('orca account list')
    expect(guide).toContain('orca account switch --to <email|id>')
    expect(guide).toContain('carries no switching logic')
    // Cached roster: resolving a name must never force a provider usage refresh.
    expect(guide).toContain("reads Orca's cached roster and quota")
  })

  it('keeps the switch on the caller’s own terminal', () => {
    const guide = readFileSync(guidePath, 'utf8')

    expect(guide).toContain('Run it with no `--terminal`')
    expect(guide).toContain('stops somebody else')
  })

  it('never answers "which account am I on" from the global active flag', () => {
    // Why asserted in both: reading `active` as the pane's account is the defect
    // (ORCA-175), and a stale fat install reads only the stub.
    const guide = readFileSync(guidePath, 'utf8')
    const stub = readFileSync(stubPath, 'utf8').replace(/\s+/g, ' ')

    expect(guide).toContain('Which account is this terminal on')
    expect(guide).toContain('Never answer this from `active`')
    expect(guide).toContain('terminal.ownership.state')
    expect(guide).toContain('never a licence to fall back to `active`')
    // The three states must stay distinguishable, and /status must stay excluded.
    expect(guide).toContain('"none"')
    expect(guide).toContain('"unknown"')
    expect(guide).toContain('do not answer from `/status`')
    expect(guide).toContain('cannot be determined')

    expect(stub).toContain('Never answer "which account am I on" from `active`')
    expect(stub).toContain('cannot be determined rather than naming one')
  })

  it('tells the agent the switch is accepted before its turn is stopped', () => {
    const guide = readFileSync(guidePath, 'utf8')

    expect(guide).toContain('returns as soon as the runtime accepts the switch')
    expect(guide).toContain('Your current turn is interrupted')
    expect(guide).toContain('Account switched to <account>; continue where you left off.')
    expect(guide).toContain('do not re-run the command')
  })

  it('forbids the manual CLAUDE_CONFIG_DIR dance in both the guide and the stub', () => {
    for (const path of [guidePath, stubPath]) {
      // Collapsed: this warning is prose, so its line wrapping is not the contract.
      const skill = readFileSync(path, 'utf8').replace(/\s+/g, ' ')
      expect(skill).toContain('CLAUDE_CONFIG_DIR')
      expect(skill).toContain('silently starts an empty session')
    }
  })

  it('ships a stub projection that routes to the version-matched guide', () => {
    const stub = readFileSync(stubPath, 'utf8')

    expect(stub).toContain('name: switch-account')
    expect(stub).toContain('This file is a discovery stub, not the usage guide.')
    expect(stub).toContain('ORCA skills get switch-account')
    // The stub must not carry the flag surface it defers to the binary for.
    expect(stub).not.toContain('--to <email|id>')
  })
})
