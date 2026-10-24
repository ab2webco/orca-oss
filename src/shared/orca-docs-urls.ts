import { ORCA_REPOSITORY_URL } from './orca-repository-url'

// Why: user docs ship in this repo under docs/user, so help links must resolve to the fork, not onorca.dev.
export const ORCA_DOCS_BASE_URL = `${ORCA_REPOSITORY_URL}/blob/main/docs/user`
export const ORCA_DOCS_INDEX_URL = `${ORCA_DOCS_BASE_URL}/README.md`
export const ORCA_CHANGELOG_URL = `${ORCA_REPOSITORY_URL}/releases`
export const ORCA_PRIVACY_URL = `${ORCA_DOCS_BASE_URL}/telemetry.md`

export function orcaDocsUrl(topic: string): string {
  return `${ORCA_DOCS_BASE_URL}/${topic}.md`
}
