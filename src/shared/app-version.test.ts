import { describe, expect, it } from 'vitest'
import {
  compareAppVersions,
  isLabRcPrereleaseAppVersion,
  isPerfPrereleaseAppVersion,
  isPrereleaseAppVersion,
  isValidAppVersion
} from './app-version'

describe('app version comparison', () => {
  it('compares stable and prerelease versions with semver precedence', () => {
    expect(compareAppVersions('1.4.9', '1.5.0')).toBeLessThan(0)
    expect(compareAppVersions('1.5.0-rc.2', '1.5.0-rc.10')).toBeLessThan(0)
    expect(compareAppVersions('1.5.0-rc.10', '1.5.0')).toBeLessThan(0)
    expect(compareAppVersions('v1.5.0+build.2', '1.5.0+build.9')).toBe(0)
  })

  it('rejects incomplete versions and identifies prereleases', () => {
    expect(isValidAppVersion('1.5')).toBe(false)
    expect(isValidAppVersion('1.5.0')).toBe(true)
    expect(isPrereleaseAppVersion('1.5.0-rc.1')).toBe(true)
    expect(isPrereleaseAppVersion('1.5.0')).toBe(false)
    expect(isPerfPrereleaseAppVersion('1.5.0-rc.1.perf')).toBe(true)
    expect(isPerfPrereleaseAppVersion('1.5.0-rc.1')).toBe(false)
    // Why: the lab RC shape must not be mistaken for a plain lab build, or the remote path
    // would offer a candidate that ordinary checks deliberately hide.
    expect(isLabRcPrereleaseAppVersion('1.4.152-lab.36.rc')).toBe(true)
    expect(isLabRcPrereleaseAppVersion('1.4.152-lab.36')).toBe(false)
    expect(isLabRcPrereleaseAppVersion('1.4.152-lab.36.rc.1')).toBe(false)
    expect(isLabRcPrereleaseAppVersion('1.4.152')).toBe(false)
  })
})
