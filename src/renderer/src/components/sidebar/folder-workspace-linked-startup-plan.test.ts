import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/types'
import { buildFolderWorkspaceLinkedStartupPlan } from './folder-workspace-linked-startup-plan'

describe('buildFolderWorkspaceLinkedStartupPlan', () => {
  it('uses cmd quoting for configured arguments on local Windows', () => {
    const plan = buildFolderWorkspaceLinkedStartupPlan({
      agent: 'hermes',
      linkedWorkItem: {
        provider: 'github',
        type: 'issue',
        number: 42,
        title: 'Restore linked quick-create',
        url: 'https://github.com/stablyai/orca/issues/42',
        repoId: 'repo-1'
      },
      note: '',
      agentCmdOverrides: {},
      agentArgs: '--provider "value with space"',
      platform: 'win32',
      shell: 'cmd',
      isRemote: false
    })

    expect(plan?.launchCommand).toBe('hermes --tui "--provider" "value with space"')
  })

  it('applies a custom Plane launch template to the quick-create draft (plane-launch-template slice 11)', () => {
    const previousSettings = useAppStore.getState().settings
    useAppStore.setState({
      settings: {
        planeLaunchPromptTemplate: 'Work on {{identifier}} — {{url}}'
      } as GlobalSettings
    })
    try {
      const plan = buildFolderWorkspaceLinkedStartupPlan({
        agent: 'claude',
        linkedWorkItem: {
          provider: 'plane',
          type: 'issue',
          number: 0,
          title: 'Fix plane quick create',
          url: 'https://app.plane.so/acme/browse/PROJ-7',
          planeIdentifier: 'PROJ-7'
        },
        note: '',
        agentCmdOverrides: {},
        platform: 'darwin',
        isRemote: false
      })

      expect(plan?.launchCommand).toBe(
        "claude --prefill 'Work on PROJ-7 — https://app.plane.so/acme/browse/PROJ-7'"
      )
    } finally {
      useAppStore.setState({ settings: previousSettings })
    }
  })
})
