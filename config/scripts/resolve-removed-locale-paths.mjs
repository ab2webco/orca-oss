#!/usr/bin/env node
// Orca Lab ships English and Spanish only (ORCA-596). Upstream keeps editing the files that removal
// deleted, so every upstream merge stops on modify/delete conflicts for them. This resolves exactly
// those paths as deleted and leaves every other conflict, fork deletions included, for a person.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const REMOVED_LOCALE_PATHS = [
  'config/scripts/bootstrap-zh-catalog.mjs',
  'config/scripts/locale-cjk-latin-spaced-terms.mjs',
  'config/scripts/locale-cjk-preservation.test.mjs',
  'config/scripts/locale-count-fragment-separator.test.mjs',
  'config/scripts/locale-ja-key-overrides.mjs',
  'config/scripts/locale-ja-phrase-fixes.mjs',
  'config/scripts/locale-ja-unified-values.mjs',
  'config/scripts/locale-ja-value-overrides.mjs',
  'config/scripts/locale-key-override-merge.mjs',
  'config/scripts/locale-ko-key-overrides.json',
  'config/scripts/locale-ko-key-overrides.mjs',
  'config/scripts/locale-ko-key-overrides.test.mjs',
  'config/scripts/locale-ko-phrase-fixes-round5.mjs',
  'config/scripts/locale-ko-phrase-fixes.mjs',
  'config/scripts/locale-ko-value-overrides.mjs',
  'config/scripts/locale-screen-cursor-exemptions.mjs',
  'config/scripts/locale-search-keyword-overrides.mjs',
  'config/scripts/locale-translation-policy-ko-round5.test.mjs',
  'config/scripts/locale-translation-policy.ja-relocalization.test.mjs',
  'config/scripts/locale-translation-policy.ja-round5.test.mjs',
  'config/scripts/locale-translation-policy.zh-round5.test.mjs',
  'config/scripts/locale-translation-policy.zh-status-bar-usage.test.mjs',
  'config/scripts/locale-zh-phrase-fixes-round5.mjs',
  'config/scripts/locale-zh-value-overrides.mjs',
  'docs/readme/README.ja.md',
  'docs/readme/README.ko.md',
  'docs/readme/README.zh-CN.md',
  'resources/claude-plugins/orca-game/hooks/locales/ja.ts',
  'resources/claude-plugins/orca-game/hooks/locales/ko.ts',
  'resources/claude-plugins/orca-game/hooks/locales/zh.ts',
  'src/renderer/src/i18n/ja-technical-literal-mistranslations.test.ts',
  'src/renderer/src/i18n/ko-ui-semantic-mistranslations.test.ts',
  'src/renderer/src/i18n/locales/ja.json',
  'src/renderer/src/i18n/locales/ko.json',
  'src/renderer/src/i18n/locales/zh.json',
  'src/renderer/src/i18n/zh-technical-literal-mistranslations.test.ts'
]

const REMOVED = new Set(REMOVED_LOCALE_PATHS)

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function isMidMerge(root) {
  const gitDir = path.resolve(root, git(root, ['rev-parse', '--git-dir']).trim())
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((head) =>
    existsSync(path.join(gitDir, head))
  )
}

/** Resolves unmerged removed-locale paths as deleted; returns the paths it resolved. */
export function resolveRemovedLocalePaths(root = process.cwd()) {
  if (!isMidMerge(root)) {
    return []
  }
  const unmerged = git(root, ['diff', '--name-only', '--diff-filter=U', '-z'])
    .split('\0')
    .filter((file) => REMOVED.has(file))
  // Why one path at a time: a pathspec could match more than the exact file.
  for (const file of unmerged) {
    git(root, ['rm', '--quiet', '--force', '--', `:(literal)${file}`])
  }
  return unmerged
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resolved = resolveRemovedLocalePaths()
  console.log(
    resolved.length === 0
      ? 'No removed locale path is in conflict.'
      : `Resolved as deleted:\n${resolved.map((file) => `  ${file}`).join('\n')}`
  )
}
