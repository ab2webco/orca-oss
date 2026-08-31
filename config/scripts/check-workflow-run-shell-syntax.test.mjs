import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Why bash rather than the script: the guard's whole value is that `bash -n` rejects
// what a workflow's own checks accept, so the contract worth pinning is what it feeds bash.
function parses(script) {
  try {
    execFileSync('bash', ['-n'], { input: script, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const withoutGithubExpressions = (script) => script.replace(/\$\{\{[^}]*\}\}/g, 'GITHUB_EXPRESSION')

describe('workflow run-block shell syntax guard', () => {
  it('rejects the unbalanced quote that shipped in lab-release finalize', () => {
    expect(parses('echo "Release $tag promoted to Latest.""')).toBe(false)
    expect(parses('echo "Release $tag promoted to Latest."')).toBe(true)
  })

  // Why substitute at all when `bash -n` tolerates `${{ }}` as a runtime bad-substitution:
  // GitHub replaces the expression before bash ever sees it, so parsing the raw text checks
  // a script that never runs — and an expression whose value carries a quote only becomes a
  // syntax error after substitution, which is the case worth catching.
  it('keeps a substituted step parseable and still catches a quote inside the value', () => {
    const step = 'if [[ "${{ inputs.dry_run }}" == "true" ]]; then echo skip; fi'
    expect(parses(withoutGithubExpressions(step))).toBe(true)
    expect(parses('echo "unterminated GITHUB_EXPRESSION')).toBe(false)
  })
})
