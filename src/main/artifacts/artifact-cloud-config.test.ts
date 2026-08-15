import { describe, expect, it } from 'vitest'
import {
  allowsArtifactCloudAuthOverride,
  resolveArtifactCloudApiUrl
} from './artifact-cloud-config'
import { ARTIFACT_SHARE_HOST } from '../../shared/artifacts'

describe('resolveArtifactCloudApiUrl', () => {
  it('uses the first-party production origin by default', () => {
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe('https://share.onorca.dev')
  })

  // Why: the pre-upload copy names ARTIFACT_SHARE_HOST, so it has to stay the default upload target.
  it('uploads to the host the publish confirmation discloses', () => {
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe(`https://${ARTIFACT_SHARE_HOST}`)
  })

  it('allows loopback HTTP only in development', () => {
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'http://127.0.0.1:45961' },
        false
      )
    ).toBe('http://127.0.0.1:45961')
    expect(() => resolveArtifactCloudApiUrl('http://127.0.0.1:45961', {}, true)).toThrow(/HTTPS/)
  })

  it('rejects origins that could receive an Orca access token', () => {
    expect(() => resolveArtifactCloudApiUrl('https://example.com', {}, false)).toThrow(
      /onorca\.dev/
    )
    expect(() => resolveArtifactCloudApiUrl('https://share.onorca.dev/path', {}, false)).toThrow(
      /origin/
    )
  })

  it('allows auth token overrides only in non-production development builds', () => {
    expect(allowsArtifactCloudAuthOverride({}, false)).toBe(true)
    expect(allowsArtifactCloudAuthOverride({ NODE_ENV: 'production' }, false)).toBe(false)
    expect(allowsArtifactCloudAuthOverride({}, true)).toBe(false)
  })
})
