// Subset of `git rev-parse --local-env-vars` that pins git to a specific repository.
// Config keys are left alone: callers layer GIT_CONFIG_* on purpose.
const REPO_LOCAL_GIT_ENV_KEYS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_PREFIX'
])

/** Drops inherited vars that would make git ignore `cwd` and resolve another repository. */
export function withoutRepoLocalGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    // Why: Windows env names are case-insensitive, so `Git_Dir` still steers git there.
    if (!REPO_LOCAL_GIT_ENV_KEYS.has(key.toUpperCase())) {
      next[key] = value
    }
  }
  return next
}
