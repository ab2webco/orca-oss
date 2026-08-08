// Why: single source of truth for the fork's own repository in user-facing
// surfaces (help links, onboarding, the gh PR/issue attribution footer). Only
// for destinations that should point at us — upstream-owned things (the skills
// repo, the plugin marketplace, upstream's mobile builds) keep stablyai/orca.

export const ORCA_REPOSITORY_URL = 'https://github.com/ab2webco/orca-oss'

/** Same repository without the scheme, for watermarks and share text. */
export const ORCA_REPOSITORY_LABEL = 'github.com/ab2webco/orca-oss'
