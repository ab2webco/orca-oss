// Why: single source of truth for the fork's own repository in user-facing
// surfaces (help links, onboarding, the gh PR/issue attribution footer, the
// agent skills source). Upstream-owned things (the plugin marketplace, upstream's
// mobile builds) keep stablyai/orca.

/** owner/name form for `gh api` paths. */
export const ORCA_REPOSITORY_SLUG = 'ab2webco/orca-oss'
export const ORCA_REPOSITORY_URL = `https://github.com/${ORCA_REPOSITORY_SLUG}`

/** Same repository without the scheme, for watermarks and share text. */
export const ORCA_REPOSITORY_LABEL = 'github.com/ab2webco/orca-oss'
