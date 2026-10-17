export const LOCALE_PHRASE_FIXES = {
  es: [
    // Why: machine translation renders the abbreviation "PR" (pull request) as
    // "relaciones públicas" (public relations). That is a real Spanish phrase, so the guard
    // matches the actual `PR`/`PRs` token (not a loose "pr" substring) to avoid rewriting
    // English that is genuinely about public relations.
    { pattern: /relaciones públicas/g, replacement: 'PR', whenEnMatches: /\bPRs?\b/ }
  ]
}
