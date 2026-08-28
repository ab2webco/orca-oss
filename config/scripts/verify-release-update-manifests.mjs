#!/usr/bin/env node
// Why this gate exists: a release that reaches GitHub's Latest pointer while one
// platform's manifest is missing sends every install of that platform into a 404
// on its next update check. The release is born a prerelease and only this check
// clears it.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// electron-builder's names: win is the unsuffixed one.
export const REQUIRED_MANIFESTS = ['latest-mac.yml', 'latest-linux.yml', 'latest.yml']

/** File names a manifest points an updater at: the top-level `path` and every `files[].url`. */
export function referencedAssetNames(manifestText) {
  const names = new Set()
  for (const line of manifestText.split('\n')) {
    const match = /^\s*(?:-\s*url|path):\s*(.+?)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const raw = match[1].replace(/^['"]|['"]$/g, '')
    if (raw === '') {
      continue
    }
    // Why decoded: electron-builder percent-encodes spaces in url, and the
    // release asset carries the decoded name.
    names.add(decodeURIComponent(raw))
  }
  return [...names]
}

export function verifyReleaseUpdateManifests({ manifestNames, readManifest, assetNames }) {
  const problems = []
  const assets = new Set(assetNames)
  for (const manifest of REQUIRED_MANIFESTS) {
    if (!manifestNames.includes(manifest)) {
      problems.push(`${manifest} is missing from the release`)
      continue
    }
    const referenced = referencedAssetNames(readManifest(manifest))
    if (referenced.length === 0) {
      problems.push(`${manifest} names no asset at all`)
      continue
    }
    for (const name of referenced) {
      if (!assets.has(name)) {
        problems.push(`${manifest} names ${name}, which the release does not have`)
      }
    }
  }
  return problems
}

function main() {
  const args = process.argv.slice(2)
  const read = (flag) => {
    const index = args.indexOf(flag)
    return index === -1 ? null : args[index + 1]
  }
  const manifestDir = read('--manifest-dir')
  const assetsFile = read('--assets-file')
  if (!manifestDir || !assetsFile) {
    console.error(
      'usage: verify-release-update-manifests.mjs --manifest-dir <dir> --assets-file <file>'
    )
    process.exit(2)
  }
  const problems = verifyReleaseUpdateManifests({
    manifestNames: readdirSync(manifestDir),
    readManifest: (name) => readFileSync(path.join(manifestDir, name), 'utf8'),
    assetNames: readFileSync(assetsFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  })
  if (problems.length > 0) {
    console.error('release update manifests are incomplete — refusing to promote it to Latest:')
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `release update manifests OK — ${REQUIRED_MANIFESTS.join(', ')} all present and every asset they name exists.`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
