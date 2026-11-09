import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: state colour in the sidebar, activity bar and cards comes from the status
// tones only; a raw palette hue here drifts from the user's chosen colours.
const STATE_SURFACES = [
  'AgentStateDot.tsx',
  'AgentWorkingSpinner.tsx',
  'StatusDot.tsx',
  'right-sidebar/activity-bar-buttons.tsx',
  'sidebar/AgentDashboardSidebarEntry.tsx',
  'sidebar/AddRemoteHostSshConfigPicker.tsx',
  'sidebar/CacheTimer.tsx',
  'sidebar/SshTargetRow.tsx',
  'sidebar/StatusIndicator.tsx',
  'sidebar/WorktreeCardMetadataStatusBadges.tsx',
  'sidebar/WorktreeCardStatusSlot.tsx',
  'sidebar/WorktreeIssueLinkField.tsx',
  'sidebar/worktree-card-meta-row.tsx',
  'sidebar/worktree-card-secondary-rows.tsx',
  'sidebar/worktree-review-helpers.tsx'
]

const RAW_STATUS_HUE =
  /\b(?:bg|text|border|ring|fill)-(?:amber|emerald|yellow|green|red|rose|orange)-\d{2,3}/

describe('status surfaces', () => {
  it.each(STATE_SURFACES)('%s uses status tones, not raw hues', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8')
    expect(source.match(RAW_STATUS_HUE)?.[0] ?? null).toBeNull()
  })
})
