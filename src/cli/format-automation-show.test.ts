import { describe, expect, it } from 'vitest'
import { formatAutomationShow } from './format'
import type { Automation } from '../shared/automations-types'

describe('formatAutomationShow', () => {
  function automation(overrides: Partial<Automation> = {}): Automation {
    return {
      id: 'auto-1',
      name: 'Nightly',
      prompt: 'Run checks',
      precheck: null,
      agentId: 'codex',
      projectId: 'repo-legacy',
      executionTargetType: 'local',
      executionTargetId: 'local',
      schedulerOwner: 'local_host_service',
      workspaceMode: 'new_per_run',
      workspaceId: null,
      baseBranch: null,
      reuseSession: false,
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: 0,
      enabled: true,
      nextRunAt: 0,
      missedRunPolicy: 'run_once_within_grace',
      missedRunGraceMinutes: 720,
      createdAt: 0,
      updatedAt: 0,
      ...overrides
    }
  }

  it('shows explicit run context before the legacy repo id', () => {
    const output = formatAutomationShow({
      automation: automation({
        runContext: {
          kind: 'workspace-run',
          projectId: 'github:stablyai/orca',
          hostId: 'runtime:gpu',
          projectHostSetupId: 'setup-gpu',
          repoId: 'repo-gpu',
          path: '/srv/orca'
        }
      })
    })

    expect(output).toContain('runProjectId: github:stablyai/orca')
    expect(output).toContain('runHostId: runtime:gpu')
    expect(output).toContain('projectHostSetupId: setup-gpu')
    expect(output).toContain('runRepoId: repo-gpu')
    expect(output).toContain('runPath: /srv/orca')
    expect(output).toContain('legacyRepoId: repo-legacy')
    expect(output).not.toContain('projectId: repo-legacy')
  })

  it('names the plugin fields the user edited, which the plugin no longer updates', () => {
    const output = formatAutomationShow({
      automation: automation({
        pluginOrigin: {
          pluginKey: 'orca-samples.wa',
          automationId: 'triage',
          managedFingerprints: { prompt: 'sha256-plugin-prompt' },
          userEditedFields: ['prompt']
        }
      })
    })

    expect(output).toContain('plugin: orca-samples.wa/triage')
    expect(output).toContain(
      'pluginEditedHere: prompt; the plugin no longer refreshes them (as of the last plugin reconcile)'
    )
  })

  it('reports a plugin row still tracking its declaration, and says nothing on a user row', () => {
    const tracking = formatAutomationShow({
      automation: automation({
        pluginOrigin: { pluginKey: 'orca-samples.wa', automationId: 'triage' }
      })
    })

    expect(tracking).toContain('pluginEditedHere: none (as of the last plugin reconcile)')
    expect(formatAutomationShow({ automation: automation() })).not.toContain('plugin:')
  })
})
