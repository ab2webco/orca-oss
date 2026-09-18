import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why a separate file from skills.test.ts: these need only the bundled guide
// table, not that suite's npx/agent-detection rig.
vi.mock('./bundled-skill-guides.js', () => ({
  BUNDLED_SKILL_GUIDES: [
    {
      name: 'alpha',
      description: 'Use when alpha work is needed.',
      markdown: '# Alpha\n\nShort.\n',
      fullMarkdown: '# Alpha\n\nShort.\n\n## References\n\nFull.\n',
      aliases: ['legacy-alpha']
    }
  ]
}))

import { dispatch } from './dispatch'

function stdoutText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('')
}

describe('orca skills get for plugin-contributed skills', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves a plugin-contributed skill and attributes it off stdout', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const call = vi.fn(async () => ({
      result: {
        name: 'send-whatsapp',
        pluginKey: 'acme.whatsapp',
        pluginName: 'WhatsApp',
        sourceLabel: 'Orca plugin WhatsApp',
        markdown: '# Send WhatsApp\n'
      }
    }))

    await dispatch(['skills', 'get'], {
      flags: new Map([['topic', 'send-whatsapp']]),
      client: { call } as never,
      cwd: '/tmp/repo',
      json: false
    })

    expect(call).toHaveBeenCalledWith('skills.getContributed', { name: 'send-whatsapp' })
    // Piping the guide must yield the plugin's bytes unchanged.
    expect(stdoutText(stdoutSpy)).toBe('# Send WhatsApp\n')
    expect(String(stderrSpy.mock.calls[0]?.[0])).toBe(
      'Contributed by Orca plugin WhatsApp (acme.whatsapp)\n'
    )
  })

  it('names the contributing plugin in get --json', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await dispatch(['skills', 'get'], {
      flags: new Map([['topic', 'send-whatsapp']]),
      client: {
        call: async () => ({
          result: {
            name: 'send-whatsapp',
            pluginKey: 'acme.whatsapp',
            pluginName: 'WhatsApp',
            sourceLabel: 'Orca plugin WhatsApp',
            markdown: '# Send WhatsApp\n'
          }
        })
      } as never,
      cwd: '/tmp/repo',
      json: true
    })

    expect(JSON.parse(stdoutText(stdoutSpy))).toEqual({
      name: 'send-whatsapp',
      full: false,
      markdown: '# Send WhatsApp\n',
      sourceLabel: 'Orca plugin WhatsApp',
      plugin: { key: 'acme.whatsapp', name: 'WhatsApp' }
    })
  })

  it('keeps a bundled topic away from the runtime even when a plugin could serve it', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const call = vi.fn()

    await dispatch(['skills', 'get'], {
      flags: new Map([['topic', 'alpha']]),
      client: { call } as never,
      cwd: '/tmp/repo',
      json: false
    })

    expect(call).not.toHaveBeenCalled()
    expect(stdoutText(stdoutSpy)).toBe('# Alpha\n\nShort.\n')
  })
})
