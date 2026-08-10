import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

// `outputStyle` names a style by its frontmatter `name:`, not by its filename
// ("Fried brain (shareable)" lives in fried-brain.md). Inheriting the string
// without the file behind it reproduces the original bug in a new place: the
// menu shows `Default ✔` and nothing says why. So the styles are linked into the
// vault first, and the key is only inherited once the name actually resolves.

// 'file', not the 'junction' the skills linker uses: a junction needs a directory
// target, so linking a .md with it throws on Windows — and the throw would be
// swallowed, leaving outputStyle permanently unresolved there.
export const OUTPUT_STYLE_LINK_TYPE = 'file'

/** Styles Claude Code ships; they resolve with no file in the styles directory. */
const BUILT_IN_OUTPUT_STYLE_NAMES = new Set(['default', 'Explanatory', 'Learning'])

function readOutputStyleName(filePath: string): string | null {
  try {
    const contents = readFileSync(filePath, 'utf-8')
    if (!contents.startsWith('---')) {
      return null
    }
    const end = contents.indexOf('\n---', 3)
    const frontmatter = end === -1 ? contents : contents.slice(0, end)
    for (const line of frontmatter.split('\n')) {
      const match = /^name:\s*(.+?)\s*$/.exec(line)
      if (match) {
        return match[1].replace(/^["']|["']$/g, '')
      }
    }
    return null
  } catch {
    return null
  }
}

/** Style names defined by the `.md` files in one output-styles directory. */
export function listOutputStyleNames(stylesDir: string): string[] {
  try {
    return readdirSync(stylesDir)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => readOutputStyleName(join(stylesDir, entry)))
      .filter((name): name is string => name !== null)
  } catch {
    return []
  }
}

/**
 * Links the user's `~/.claude/output-styles/*.md` into `<vault>/output-styles` as
 * per-file symlinks, so an edit at home shows up in every vault. Never replaces an
 * entry that already exists — a vault that was fixed by hand keeps its own copy
 * rather than being silently swapped for a link. Best-effort per file.
 */
export function ensureVaultOutputStyleLinks(vaultAuthPath: string, homeDir: string): void {
  const homeStyles = join(homeDir, '.claude', 'output-styles')
  if (!existsSync(homeStyles)) {
    return
  }
  const vaultStyles = join(vaultAuthPath, 'output-styles')
  try {
    mkdirSync(vaultStyles, { recursive: true })
  } catch {
    return
  }
  let entries: string[]
  try {
    entries = readdirSync(homeStyles)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue
    }
    const dest = join(vaultStyles, entry)
    try {
      lstatSync(dest)
      continue
    } catch {
      // Nothing there — safe to link below.
    }
    try {
      symlinkSync(join(homeStyles, entry), dest, OUTPUT_STYLE_LINK_TYPE)
    } catch {
      // Best effort — one unlinkable style must not stop the rest.
    }
  }
}

/** Whether an `outputStyle` value can actually load inside this vault. */
export function outputStyleResolvesInVault(vaultAuthPath: string, styleName: unknown): boolean {
  if (typeof styleName !== 'string' || styleName.length === 0) {
    return false
  }
  if (BUILT_IN_OUTPUT_STYLE_NAMES.has(styleName)) {
    return true
  }
  return listOutputStyleNames(join(vaultAuthPath, 'output-styles')).includes(styleName)
}
