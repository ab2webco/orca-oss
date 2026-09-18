// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { PluginConsentDialog } from './PluginConsentDialog'

const plugin: PluginHostListEntry = {
  pluginKey: 'acme.worker',
  consentFingerprint: 'sha256-acme-worker',
  name: 'Acme Worker',
  version: '1.2.3',
  publisher: 'acme',
  status: 'pending',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [{ kind: 'worker', description: 'Run a background worker process' }],
  panels: [],
  commands: [],
  hasWorker: true,
  restarts: 0,
  source: {
    kind: 'git',
    reference: 'https://gitlab.example/acme/worker#v1.2.3',
    resolvedCommit: '0123456789abcdef',
    contentHash: 'sha256'
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { plugins: {} }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'api')
})

async function renderConsent(
  entry: PluginHostListEntry,
  onDecision: (
    key: string,
    reviewedFingerprint: string,
    decision: 'approve' | 'keep-disabled'
  ) => Promise<void>
): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  function Harness(): React.JSX.Element {
    const [selected, setSelected] = useState<PluginHostListEntry | null>(entry)
    return (
      <PluginConsentDialog
        plugin={selected}
        onDecision={async (key, reviewedFingerprint, decision) => {
          await onDecision(key, reviewedFingerprint, decision)
          setSelected(null)
        }}
      />
    )
  }
  await act(async () => root.render(<Harness />))
  await act(() => new Promise<void>((resolve) => queueMicrotask(resolve)))
}

describe('PluginConsentDialog', () => {
  it('discloses the authority of programs started by the worker', async () => {
    await renderConsent(
      {
        ...plugin,
        capabilities: [{ kind: 'process:spawn', description: 'unsafe fallback' }]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain(
      "Start programs as you. Programs it starts are not constrained by this plugin worker's file or network permissions."
    )
    expect(document.body.textContent).toContain('(process:spawn)')
    expect(document.body.textContent).not.toContain('unsafe fallback')
  })

  it('spells out that a skills:contribute plugin reaches every agent', async () => {
    await renderConsent(
      {
        ...plugin,
        hasWorker: false,
        skills: ['skills/hello'],
        capabilities: [
          {
            kind: 'skills:contribute',
            description: 'Teach every agent, in every project, how to use this plugin'
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain(
      'Teach every agent, in every project, how to use this plugin: its skill instructions ' +
        'are served to any agent that asks for them'
    )
    expect(document.body.textContent).toContain('(skills:contribute)')
    // A skill is read and acted on by an agent, so the tier must not read
    // "Panel" the way a panel-only plugin does.
    expect(document.body.textContent).toContain('Instructional')
    expect(document.body.textContent).toContain('Review access and content')
    // Nothing here fires by itself, so this plugin keeps the use-time warning.
    expect(document.body.textContent).toContain(
      'Its instructional content can still cause actions when you or an agent use it.'
    )
    expect(document.body.textContent).not.toContain('runs on its own schedule')
  })

  it('keeps the displayed fingerprint immutable during a same-key update', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onDecision = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      root.render(<PluginConsentDialog plugin={plugin} onDecision={onDecision} />)
    })
    await act(async () => {
      root.render(
        <PluginConsentDialog
          plugin={{
            ...plugin,
            consentFingerprint: 'sha256-unreviewed-update',
            capabilities: [{ kind: 'secrets:read', description: 'Read a newly added secret' }]
          }}
          onDecision={onDecision}
        />
      )
    })

    expect(document.body.textContent).not.toContain('Read a newly added secret')
    const enable = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Enable plugin'
    )
    await act(async () => enable?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(onDecision).toHaveBeenCalledWith(plugin.pluginKey, plugin.consentFingerprint, 'approve')
  })

  it('shows provenance, capabilities, worker warning, and focuses the safe default', async () => {
    await renderConsent(plugin, vi.fn().mockResolvedValue(undefined))

    // Provenance leads with a short badge + a short trust chip; the full
    // source URL and commit are tucked behind the "Source" details popover.
    expect(document.body.textContent).toContain(plugin.publisher)
    expect(document.body.textContent).toContain('Worker')
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (candidate) => candidate.textContent?.trim() === 'Source'
      )
    ).toBe(true)
    expect(document.body.textContent).toContain('Run a background worker process')
    expect(document.body.textContent).toContain('can read its plugin files')
    expect(document.body.textContent).toContain(
      'Network access is blocked because this plugin does not request net:fetch.'
    )
    expect(document.querySelector('[role="dialog"]')?.classList).toContain('plugin-security-chrome')
    expect(document.activeElement?.textContent).toContain('Keep Disabled')
  })

  it('shows the declared network scope during re-consent', async () => {
    await renderConsent(
      {
        ...plugin,
        needsReconsent: true,
        capabilities: [
          {
            kind: 'net:fetch',
            description: 'Connect to these network hosts: hooks.example.com'
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain('Connect to these network hosts: hooks.example.com')
    expect(document.body.textContent).toContain(
      'Network requests are restricted to the hosts declared above.'
    )
  })

  it('explains that panel-only plugins have no worker process', async () => {
    await renderConsent(
      {
        ...plugin,
        pluginKey: 'acme.panel',
        name: 'Acme Panel',
        hasWorker: false,
        capabilities: [{ kind: 'panels', description: 'Add an Acme panel' }]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain(
      "These permissions limit how the plugin uses Orca Lab's API. This plugin has no background worker."
    )
    expect(document.body.textContent).not.toContain('full access to your files')
    expect(document.body.textContent).not.toContain('connect to any host on the internet')
  })

  it('describes inert content without pretending it requested permissions', async () => {
    await renderConsent(
      {
        ...plugin,
        pluginKey: 'acme.icons',
        name: 'Acme Icons',
        hasWorker: false,
        capabilities: []
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain('Review plugin')
    expect(document.body.textContent).toContain('Declarative')
    expect(document.body.textContent).toContain(
      "This plugin contributes validated content only. It does not run a background worker or receive access to Orca Lab's API."
    )
    expect(document.body.textContent).not.toContain('These permissions limit')
  })

  it('shows the shell command a contributed automation would run on a schedule', async () => {
    await renderConsent(
      {
        ...plugin,
        pluginKey: 'acme.sync',
        name: 'Acme Sync',
        hasWorker: false,
        capabilities: [],
        panels: [],
        automations: [
          {
            id: 'mirror',
            title: 'Mirror the vault',
            trigger: '*/5 * * * *',
            command: 'rsync -a --delete "$HOME/vault/" backup:/vault/'
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    // A scheduled shell command is not "validated content only".
    expect(document.body.textContent).not.toContain('Declarative')
    expect(document.body.textContent).not.toContain('contributes validated content only')
    // Nor does it wait for someone to use it: the warning must say it fires alone.
    expect(document.body.textContent).toContain(
      'it runs on its own schedule — the command below is what Orca Lab will run, at the times ' +
        'shown, whether or not you are here'
    )
    expect(document.body.textContent).not.toContain('when you or an agent use it')
    expect(document.body.textContent).toContain('Instructional')
    expect(document.body.textContent).toContain('Mirror the vault')
    expect(document.body.textContent).toContain('*/5 * * * *')
    const commands = Array.from(document.querySelectorAll('pre'))
    expect(commands.map((node) => node.textContent)).toEqual([
      'rsync -a --delete "$HOME/vault/" backup:/vault/'
    ])
    expect(commands[0]?.getAttribute('aria-label')).toBe('Mirror the vault · command')
  })

  it('shows every VM recipe lifecycle command verbatim', async () => {
    await renderConsent(
      {
        ...plugin,
        hasWorker: false,
        skills: ['skills/hello'],
        capabilities: [],
        vmRecipes: [
          {
            id: 'cloud',
            name: 'Cloud Sandbox',
            description: 'Creates a disposable VM.',
            commands: [
              { phase: 'create', command: './scripts/create.sh --exact "$VALUE"' },
              { phase: 'suspend', command: './scripts/suspend.sh' },
              { phase: 'resume', command: './scripts/resume.sh' },
              { phase: 'destroy', command: 'none' }
            ]
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain('Instructional')
    expect(document.body.textContent).toContain('Review plugin content')
    expect(document.body.textContent).toContain(
      'Its instructional content can still cause actions when you or an agent use it.'
    )
    expect(document.body.textContent).toContain('./scripts/create.sh --exact "$VALUE"')
    expect(document.body.textContent).toContain('./scripts/suspend.sh')
    expect(document.body.textContent).toContain('./scripts/resume.sh')
    expect(document.body.textContent).toContain('Destroynone')
    const commands = Array.from(document.querySelectorAll('pre'))
    expect(commands).toHaveLength(4)
    expect(commands[0]?.tabIndex).toBe(0)
    expect(commands[0]?.getAttribute('aria-label')).toBe('Cloud Sandbox · Create command')
  })

  it('shows plugin shortcuts and names built-in chords they replace', async () => {
    await renderConsent(
      {
        ...plugin,
        hasWorker: false,
        skills: ['skills/hello'],
        capabilities: [],
        commands: [
          {
            id: 'tasks',
            title: 'Open Tasks',
            context: 'global',
            handler: { type: 'built-in', action: 'view.tasks' },
            keybindings: [{ key: 'Mod+P', when: 'global' }]
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.body.textContent).toContain('Review plugin content')
    expect(document.body.textContent).toContain('Keyboard shortcuts')
    expect(document.body.textContent).toContain('Open Tasks')
    expect(document.body.textContent).toContain('Replaces: Go to File')
  })

  it('shows the precheck a contributed automation runs before its command', async () => {
    await renderConsent(
      {
        ...plugin,
        pluginKey: 'acme.sync',
        name: 'Acme Sync',
        hasWorker: false,
        capabilities: [],
        panels: [],
        automations: [
          {
            id: 'mirror',
            title: 'Mirror the vault',
            trigger: '*/5 * * * *',
            precheck: 'curl -fsSL https://vault.example/flag | sh',
            command: 'rsync -a --delete "$HOME/vault/" backup:/vault/'
          }
        ]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    // El precheck corre en cada corrida programada: ocultarlo deja al usuario
    // aprobando un comando que nunca vio.
    const shown = Array.from(document.querySelectorAll('pre'))
    expect(shown.map((node) => node.textContent)).toEqual([
      'curl -fsSL https://vault.example/flag | sh',
      'rsync -a --delete "$HOME/vault/" backup:/vault/'
    ])
    expect(shown[0]?.getAttribute('aria-label')).toBe('Mirror the vault · precheck')
  })

  it('does not promise a command below for an agent-only contributed automation', async () => {
    await renderConsent(
      {
        ...plugin,
        pluginKey: 'acme.review',
        name: 'Acme Review',
        hasWorker: false,
        capabilities: [],
        panels: [],
        automations: [{ id: 'review', title: 'Nightly review', trigger: '0 3 * * *' }]
      },
      vi.fn().mockResolvedValue(undefined)
    )

    expect(document.querySelectorAll('pre')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('the command below is what Orca Lab will run')
    // Sigue corriendo sola: lo que cambia es que abajo no hay comando que leer.
    expect(document.body.textContent).toContain(
      'it runs on its own schedule — it launches a coding agent with the prompt shipped inside ' +
        'the plugin, at the times shown, whether or not you are here'
    )
    expect(document.body.textContent).not.toContain('when you or an agent use it')
  })

  it('records Keep Disabled when Escape dismisses the dialog', async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined)
    await renderConsent(plugin, onDecision)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onDecision).toHaveBeenCalledWith(
      plugin.pluginKey,
      plugin.consentFingerprint,
      'keep-disabled'
    )
  })

  it('labels re-consent generically and enables only after an explicit action', async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined)
    await renderConsent({ ...plugin, needsReconsent: true }, onDecision)
    expect(document.body.textContent).toContain(
      'Permissions, the worker trust tier, or instructional content changed'
    )
    const enable = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Enable plugin'
    )
    if (!enable) {
      throw new Error('missing enable action')
    }

    await act(async () => enable.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(onDecision).toHaveBeenCalledWith(plugin.pluginKey, plugin.consentFingerprint, 'approve')
  })

  it('explains how to recover when the reviewed plugin changed', async () => {
    const onDecision = vi
      .fn()
      .mockRejectedValue(new Error('reviewed fingerprint is no longer current'))
    await renderConsent(plugin, onDecision)
    const enable = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Enable plugin'
    )

    await act(async () => enable?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(document.body.textContent).toContain(
      'The plugin changed while you were reviewing it. Close this dialog and review the updated permissions.'
    )
  })
})
