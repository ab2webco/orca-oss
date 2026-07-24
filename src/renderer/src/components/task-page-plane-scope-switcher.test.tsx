// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlaneProject, PlaneWorkspace } from '../../../shared/plane-types'
import { TaskPagePlaneScopeSwitcher } from './task-page-plane-scope-switcher'

afterEach(cleanup)

const workspaces: PlaneWorkspace[] = [
  { id: 'ws-1', baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', displayName: 'Acme' },
  { id: 'ws-2', baseUrl: 'https://api.plane.so', workspaceSlug: 'beta', displayName: 'Beta' }
]

const projects: PlaneProject[] = [
  { id: 'proj-1', identifier: 'ACM', name: 'Acme Roadmap' },
  { id: 'proj-2', identifier: 'BET', name: 'Beta Launch' }
]

function renderSwitcher(
  overrides: Partial<React.ComponentProps<typeof TaskPagePlaneScopeSwitcher>> = {}
): {
  onWorkspaceChange: ReturnType<typeof vi.fn>
  onProjectChange: ReturnType<typeof vi.fn>
} {
  const onWorkspaceChange = vi.fn()
  const onProjectChange = vi.fn()
  render(
    <TaskPagePlaneScopeSwitcher
      workspaces={workspaces}
      selectedWorkspaceId="ws-1"
      onWorkspaceChange={onWorkspaceChange}
      projects={projects}
      projectsLoading={false}
      selectedProjectId="all"
      onProjectChange={onProjectChange}
      {...overrides}
    />
  )
  return { onWorkspaceChange, onProjectChange }
}

describe('TaskPagePlaneScopeSwitcher', () => {
  it('hides the workspace switcher when only one workspace is connected', () => {
    renderSwitcher({ workspaces: [workspaces[0]] })
    expect(screen.queryByRole('combobox', { name: 'Plane workspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Plane project' })).toBeInTheDocument()
  })

  it('offers an "All Plane workspaces" option alongside each workspace', async () => {
    const user = userEvent.setup()
    const { onWorkspaceChange } = renderSwitcher()

    await user.click(screen.getByRole('combobox', { name: 'Plane workspace' }))
    expect(screen.getByRole('option', { name: 'All Plane workspaces' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Beta' }))

    expect(onWorkspaceChange).toHaveBeenCalledWith('ws-2')
  })

  it('offers an "All projects" option alongside each project', async () => {
    const user = userEvent.setup()
    const { onProjectChange } = renderSwitcher()

    await user.click(screen.getByRole('combobox', { name: 'Plane project' }))
    expect(screen.getByRole('option', { name: 'All projects' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Beta Launch' }))

    expect(onProjectChange).toHaveBeenCalledWith('proj-2')
  })

  it('disables the project switcher when the workspace scope is "all"', () => {
    renderSwitcher({ selectedWorkspaceId: 'all' })
    expect(screen.getByRole('combobox', { name: 'Plane project' })).toBeDisabled()
  })

  it('disables the project switcher while projects are loading', () => {
    renderSwitcher({ projectsLoading: true })
    expect(screen.getByRole('combobox', { name: 'Plane project' })).toBeDisabled()
  })
})
