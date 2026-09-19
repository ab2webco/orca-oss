// @vitest-environment happy-dom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '../../../../shared/automations-types'
import { AutomationDetail } from './AutomationDetail'

// Why: Tooltip needs a provider in the app; stub so the header renders standalone.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const PAUSED_HINT = 'A plugin added this automation paused — use Resume to start it.'
const PLUGIN_ORIGIN = { pluginKey: 'ab2web.orca-wa-inbox', automationId: 'sync' }

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    name: 'Inbox sync',
    prompt: '',
    precheck: null,
    agentId: null,
    command: { command: 'inbox sync --quiet', timeoutSeconds: 600 },
    projectId: 'repo-1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'new_per_run',
    workspaceId: null,
    baseBranch: null,
    reuseSession: false,
    timezone: 'UTC',
    rrule: 'FREQ=DAILY',
    dtstart: 1,
    enabled: false,
    nextRunAt: 0,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 720,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function renderDetail(automation: Automation) {
  return render(
    <AutomationDetail
      automation={automation}
      runs={[]}
      projectName="Inbox (plugin)"
      workspaceName="Inbox (plugin)"
      projectDefaultBaseRef={null}
      runNowAvailability={null}
      now={Date.now()}
      onRunNow={vi.fn()}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AutomationDetail plugin-contributed rows', () => {
  it('says what it takes to start a row the plugin left paused', () => {
    renderDetail(makeAutomation({ pluginOrigin: PLUGIN_ORIGIN }))

    expect(screen.getByText(PAUSED_HINT)).toBeTruthy()
  })

  it('stays quiet once that row is resumed, and for a row the user paused', () => {
    renderDetail(makeAutomation({ enabled: true, pluginOrigin: PLUGIN_ORIGIN }))
    expect(screen.queryByText(PAUSED_HINT)).toBeNull()

    cleanup()
    renderDetail(makeAutomation())
    expect(screen.queryByText(PAUSED_HINT)).toBeNull()
  })
})
