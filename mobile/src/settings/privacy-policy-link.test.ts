import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why a source read and not a render: the URL is a literal in an onPress, and what the
// stores check is which address the app actually opens (ORCA-336).
const SETTINGS_SOURCE = readFileSync(join(__dirname, '..', '..', 'app', 'settings.tsx'), 'utf8')

const OWN_POLICY_URL = 'https://core.ab2web.com/knowledgebase/9/Privacy-Policy--Orca-Lab.html'

describe('the mobile Privacy Policy row', () => {
  it('opens the policy this fork publishes', () => {
    expect(SETTINGS_SOURCE).toContain(OWN_POLICY_URL)
  })

  it('never sends users to the upstream policy, which is not ours', () => {
    expect(SETTINGS_SOURCE).not.toContain('onorca.dev/privacy')
  })

  it('reads a file that exists, so a passing check is not an empty read', () => {
    expect(SETTINGS_SOURCE).toContain('Privacy Policy')
  })
})
