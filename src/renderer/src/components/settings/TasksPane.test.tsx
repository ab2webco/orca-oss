// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TasksPane } from './TasksPane'
import { getDefaultSettings } from '../../../../shared/constants'

afterEach(() => {
  cleanup()
})

describe('TasksPane Linear launch template', () => {
  it('persists an edited template on blur', () => {
    const updateSettings = vi.fn()
    render(
      <TasksPane settings={getDefaultSettings('/home/test')} updateSettings={updateSettings} />
    )

    const textarea = screen.getByRole('textbox', {
      name: /linear launch prompt template/i
    })
    fireEvent.change(textarea, { target: { value: 'Do {{identifier}}' } })
    fireEvent.blur(textarea)

    expect(updateSettings).toHaveBeenCalledWith({ linearLaunchPromptTemplate: 'Do {{identifier}}' })
  })
})

describe('TasksPane Plane launch template', () => {
  it('persists an edited template on blur', () => {
    const updateSettings = vi.fn()
    render(
      <TasksPane settings={getDefaultSettings('/home/test')} updateSettings={updateSettings} />
    )

    const textarea = screen.getByRole('textbox', {
      name: /plane launch prompt template/i
    })
    fireEvent.change(textarea, { target: { value: 'Do {{identifier}}' } })
    fireEvent.blur(textarea)

    expect(updateSettings).toHaveBeenCalledWith({ planeLaunchPromptTemplate: 'Do {{identifier}}' })
  })
})

describe('TasksPane task provider visibility', () => {
  it('lists Plane as a task provider row', () => {
    const updateSettings = vi.fn()
    render(
      <TasksPane settings={getDefaultSettings('/home/test')} updateSettings={updateSettings} />
    )

    expect(screen.getByRole('checkbox', { name: /Plane/ })).toBeTruthy()
  })
})
