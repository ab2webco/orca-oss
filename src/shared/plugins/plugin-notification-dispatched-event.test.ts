import { describe, expect, it } from 'vitest'
import { fingerprintPluginConsent } from './plugin-consent-fingerprint'
import { describePluginCapability, type PluginCapabilityKind } from './plugin-capabilities'
import {
  isPluginEventGranted,
  NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH,
  NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH,
  PLUGIN_EVENT_PAYLOAD_SCHEMAS
} from './plugin-events'
import { parsePluginManifest, PLUGIN_EVENT_NAMES, pluginManifestSchema } from './plugin-manifest'

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'relay',
    publisher: 'orca-samples',
    name: 'Relay',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: { events: [{ on: 'notification.dispatched' }] },
    capabilities: [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }],
    ...overrides
  }
}

const payloadSchema = PLUGIN_EVENT_PAYLOAD_SCHEMAS['notification.dispatched']

describe('notification.dispatched manifest contract', () => {
  it('is part of the closed event set', () => {
    expect(PLUGIN_EVENT_NAMES).toContain('notification.dispatched')
  })

  it('accepts a subscription backed by events:subscribe and notifications:observe', () => {
    expect(parsePluginManifest(manifest())).toMatchObject({ ok: true })
  })

  it('rejects a subscription without notifications:observe', () => {
    const result = parsePluginManifest(manifest({ capabilities: [{ kind: 'events:subscribe' }] }))
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('notifications:observe')
  })

  it('keeps manifests that do not subscribe to it valid without the new capability', () => {
    expect(
      parsePluginManifest(
        manifest({
          contributes: { events: [{ on: 'agent.status.changed' }] },
          capabilities: [{ kind: 'events:subscribe' }]
        })
      ).ok
    ).toBe(true)
  })

  it('describes the capability honestly in the consent copy', () => {
    const description = describePluginCapability({ kind: 'notifications:observe' })
    expect(description).toContain('notifications')
    expect(description).toContain('agent replies')
  })

  it('changes the consent fingerprint so adding it re-prompts', () => {
    const without = pluginManifestSchema.parse(
      manifest({ contributes: { events: [] }, capabilities: [{ kind: 'events:subscribe' }] })
    )
    const withObserve = pluginManifestSchema.parse(manifest())
    expect(fingerprintPluginConsent(withObserve)).not.toBe(fingerprintPluginConsent(without))
  })
})

describe('notification.dispatched payload', () => {
  const valid = {
    source: 'agent-task-complete',
    worktreeId: 'repo::wt1',
    title: 'feat/x - Claude needs input',
    body: 'Should I run the migration?',
    at: 1_790_000_000_000
  }

  it('accepts the bounded projection and a null worktree', () => {
    expect(payloadSchema.safeParse(valid).success).toBe(true)
    expect(payloadSchema.safeParse({ ...valid, worktreeId: null }).success).toBe(true)
  })

  it('never carries a plugin-sourced notification', () => {
    expect(payloadSchema.safeParse({ ...valid, source: 'plugin' }).success).toBe(false)
  })

  it('rejects an unbounded title or body', () => {
    expect(
      payloadSchema.safeParse({
        ...valid,
        title: 'x'.repeat(NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
    expect(
      payloadSchema.safeParse({
        ...valid,
        body: 'x'.repeat(NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
  })

  it('strips fields outside the projection', () => {
    const parsed = payloadSchema.parse({ ...valid, agentPrompt: 'secret prompt' })
    expect(parsed).not.toHaveProperty('agentPrompt')
  })
})

describe('isPluginEventGranted', () => {
  const subscribeOnly: PluginCapabilityKind[] = ['events:subscribe']
  const observe: PluginCapabilityKind[] = ['events:subscribe', 'notifications:observe']

  it('requires notifications:observe for notification.dispatched', () => {
    expect(isPluginEventGranted(subscribeOnly, 'notification.dispatched')).toBe(false)
    expect(isPluginEventGranted(observe, 'notification.dispatched')).toBe(true)
  })

  it('keeps the existing events on events:subscribe alone', () => {
    expect(isPluginEventGranted(subscribeOnly, 'agent.status.changed')).toBe(true)
    expect(isPluginEventGranted(subscribeOnly, 'worktree.created')).toBe(true)
  })

  it('denies everything without consent or without events:subscribe', () => {
    expect(isPluginEventGranted(null, 'worktree.created')).toBe(false)
    expect(isPluginEventGranted(['notifications:observe'], 'notification.dispatched')).toBe(false)
  })
})
