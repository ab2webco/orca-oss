import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs script, no declaration file
import {
  REQUIRED_MANIFESTS,
  referencedAssetNames,
  verifyReleaseUpdateManifests
} from './verify-release-update-manifests.mjs'

const MAC = `version: 1.4.160-lab.43
files:
  - url: Orca-1.4.160-lab.43-arm64-mac.zip
    sha512: aa
  - url: Orca-1.4.160-lab.43-mac.zip
    sha512: bb
path: Orca-1.4.160-lab.43-arm64-mac.zip
`
const LINUX = `version: 1.4.160-lab.43
files:
  - url: Orca-1.4.160-lab.43.AppImage
path: Orca-1.4.160-lab.43.AppImage
`
const WIN = `version: 1.4.160-lab.43
files:
  - url: Orca%20Setup%201.4.160-lab.43.exe
path: Orca%20Setup%201.4.160-lab.43.exe
`

const MANIFESTS: Record<string, string> = {
  'latest-mac.yml': MAC,
  'latest-linux.yml': LINUX,
  'latest.yml': WIN
}

const ALL_ASSETS = [
  'Orca-1.4.160-lab.43-arm64-mac.zip',
  'Orca-1.4.160-lab.43-mac.zip',
  'Orca-1.4.160-lab.43.AppImage',
  'Orca Setup 1.4.160-lab.43.exe'
]

function verify(manifestNames: string[], assetNames: string[]): string[] {
  return verifyReleaseUpdateManifests({
    manifestNames,
    readManifest: (name: string) => MANIFESTS[name] ?? '',
    assetNames
  })
}

describe('referencedAssetNames', () => {
  it('decodes the percent-encoding electron-builder writes into url', () => {
    expect(referencedAssetNames(WIN)).toEqual(['Orca Setup 1.4.160-lab.43.exe'])
  })

  it('collects every files[].url as well as the top-level path', () => {
    expect(referencedAssetNames(MAC)).toEqual([
      'Orca-1.4.160-lab.43-arm64-mac.zip',
      'Orca-1.4.160-lab.43-mac.zip'
    ])
  })
})

describe('verifyReleaseUpdateManifests', () => {
  it('passes when all three manifests are there and every asset they name exists', () => {
    expect(verify(REQUIRED_MANIFESTS, ALL_ASSETS)).toEqual([])
  })

  // The mutation this gate exists for: the mac job failed, so its manifest never
  // reached the release.
  it('refuses when a platform manifest is missing', () => {
    const problems = verify(['latest-linux.yml', 'latest.yml'], ALL_ASSETS)
    expect(problems).toEqual(['latest-mac.yml is missing from the release'])
  })

  // The subtler half: the manifest uploaded but its zip did not, which an
  // existence check on the manifest alone would call green.
  it('refuses when a manifest names an asset the release does not have', () => {
    const problems = verify(
      REQUIRED_MANIFESTS,
      ALL_ASSETS.filter((name) => name !== 'Orca-1.4.160-lab.43-mac.zip')
    )
    expect(problems).toEqual([
      'latest-mac.yml names Orca-1.4.160-lab.43-mac.zip, which the release does not have'
    ])
  })

  it('refuses a manifest that names nothing rather than reading it as satisfied', () => {
    const problems = verifyReleaseUpdateManifests({
      manifestNames: REQUIRED_MANIFESTS,
      readManifest: (name: string) =>
        name === 'latest.yml' ? 'version: 1.2.3\n' : MANIFESTS[name],
      assetNames: ALL_ASSETS
    })
    expect(problems).toEqual(['latest.yml names no asset at all'])
  })
})
