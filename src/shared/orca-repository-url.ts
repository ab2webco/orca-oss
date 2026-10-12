// Why: single source of truth for the fork's own repository in user-facing
// surfaces (help links, onboarding, the gh PR/issue attribution footer). Only
// for destinations that should point at us — upstream-owned things (the skills
// repo, the plugin marketplace, upstream's mobile builds) keep stablyai/orca.

/** owner/name form for `gh api` paths. */
export const ORCA_REPOSITORY_SLUG = 'ab2webco/orca-oss'
export const ORCA_REPOSITORY_URL = `https://github.com/${ORCA_REPOSITORY_SLUG}`

/** Same repository without the scheme, for watermarks and share text. */
export const ORCA_REPOSITORY_LABEL = 'github.com/ab2webco/orca-oss'
