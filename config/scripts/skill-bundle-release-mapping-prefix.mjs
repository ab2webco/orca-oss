import { isDeepStrictEqual } from 'node:util'

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

// A release cut can append rows whose revisions still equal the current
// manifest. Those rows are redundant until skill bytes change, so older
// branches may accept the committed prefix without regenerating identities.
export function isToleratedReleaseMappingPrefix(committedText, artifacts) {
  let committed
  try {
    committed = JSON.parse(committedText)
  } catch {
    return false
  }
  const derived = artifacts.releaseMapping
  const committedCount = Array.isArray(committed?.releases) ? committed.releases.length : -1
  if (committedCount < 0 || committedCount >= derived.releases.length) {
    return false
  }
  const prefix = {
    schemaVersion: derived.schemaVersion,
    releases: derived.releases.slice(0, committedCount)
  }
  if (committedText !== serialized(prefix)) {
    return false
  }
  const currentRevisions = Object.fromEntries(
    artifacts.currentManifest.skills.map((skill) => [skill.name, skill.releaseRevision])
  )
  return derived.releases
    .slice(committedCount)
    .every((release) => isDeepStrictEqual(release.skills, currentRevisions))
}
