// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { usePluginSettingsEditor } from './use-plugin-settings-editor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const plugin: PluginHostListEntry = {
  pluginKey: 'acme.notes',
  consentFingerprint: 'sha256-acme-notes',
  name: 'Notes',
  version: '1.0.0',
  publisher: 'acme',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0
}

const secondPlugin: PluginHostListEntry = { ...plugin, pluginKey: 'acme.tasks', name: 'Tasks' }

// Module-level so references stay stable across renders — an inline array literal
// would differ by identity on every render and spin the render-phase guard forever.
const onlyFirst = [plugin]
const bothPlugins = [plugin, secondPlugin]
const onlySecond = [secondPlugin]

type Commit = { mounted: boolean; open: boolean }

describe('usePluginSettingsEditor', () => {
  let root: Root | undefined

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
    }
    document.body.replaceChildren()
    root = undefined
  })

  it('never paints a stale open-settings panel for the frame the pane closes on', () => {
    const commits: Commit[] = []
    let toggle!: (pluginKey: string) => void

    function Harness({ mounted }: { mounted: boolean }): null {
      const mountedRef = useRef(mounted)
      useLayoutEffect(() => {
        mountedRef.current = mounted
      }, [mounted])
      const editor = usePluginSettingsEditor(mounted, mountedRef, onlyFirst, () => {})
      toggle = editor.toggleSettings
      useLayoutEffect(() => {
        commits.push({ mounted, open: editor.openSettings.has(plugin.pluginKey) })
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<Harness mounted={true} />)
    })
    act(() => {
      toggle(plugin.pluginKey)
    })
    expect(commits.at(-1)).toEqual({ mounted: true, open: true })

    commits.length = 0

    // Closing the pane must clear the accordion state in the very same commit — not one
    // frame later via an effect, which would briefly paint the stale open panel.
    flushSync(() => {
      root!.render(<Harness mounted={false} />)
    })

    expect(commits).toEqual([{ mounted: false, open: false }])
  })

  it('never paints the previous plugin as still open when switching the edited plugin', () => {
    const commits: Commit[] = []
    let toggle!: (pluginKey: string) => void

    function Harness({ plugins }: { plugins: readonly PluginHostListEntry[] }): null {
      const mountedRef = useRef(true)
      const editor = usePluginSettingsEditor(true, mountedRef, plugins, () => {})
      toggle = editor.toggleSettings
      useLayoutEffect(() => {
        commits.push({ mounted: true, open: editor.openSettings.has(plugin.pluginKey) })
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root!.render(<Harness plugins={bothPlugins} />)
    })
    act(() => {
      toggle(plugin.pluginKey)
    })
    expect(commits.at(-1)).toEqual({ mounted: true, open: true })

    commits.length = 0

    // Switching the edited plugin (the first plugin is no longer installed) must discard
    // its open-settings state in the same commit, never paint it stale for a frame first.
    flushSync(() => {
      root!.render(<Harness plugins={onlySecond} />)
    })

    expect(commits).toEqual([{ mounted: true, open: false }])
  })
})
