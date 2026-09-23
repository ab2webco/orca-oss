#!/usr/bin/env node
// This repo forbids AI authorship credit in commit messages, and nothing verified it: review
// reads `gh pr diff`, which shows the patch and never the message, so two commits reached main
// with `Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>` (ORCA-529). A squash merge
// copies the trailer from the branch commit into the commit that lands, so the PR is the last
// cheap place to catch it.
//
// What counts as AI attribution, and what does not:
//   - An authorship trailer (Co-authored-by, Signed-off-by, Assisted-by…) is a finding only when
//     the identity it credits is a known assistant — a tool no-reply address such as
//     noreply@anthropic.com, or a name that IS the assistant plus a model/version qualifier.
//     The rule is against crediting a machine, not against Co-authored-by: a human co-author is
//     the normal way to share credit and must keep passing. Unknown identities are therefore
//     treated as human. The signals are deliberately identity-shaped rather than substring
//     matches because this history holds `Neil Parker <nwparker@anthropic.com>` (a person at
//     Anthropic), `LauraGPT`, `Devin345458` and `federico-ntb@notchatbot.com` — all humans that
//     a vendor-domain or substring rule would have failed.
//   - A tool signature line ("🤖 Generated with [Claude Code](…)") is a finding: it is credit in
//     prose rather than in a trailer.
//   - `Claude-Session: <url>` is NOT a finding. It is the session provenance link this repo
//     requires; it records where the change was produced, it does not credit an author.
import { execFileSync } from 'node:child_process'
import process from 'node:process'

// Assistant identities as a tool writes them. Bare product names only: the qualifier tail below
// absorbs the model/version, so `Claude Dupont` (a person) does not match while `Claude Opus 5`
// does.
const ASSISTANT =
  '(?:claude|codex|chatgpt|copilot|cursor|devin|gemini|jules|amp|aider|windsurf|cline|goose|junie|antigravity|grok|opencode|tabnine|openai|anthropic)'

// What may follow an assistant name and still be the same identity: a model, a version, a link,
// punctuation. Anything else — an ordinary surname, a sentence — means this is not a tool.
const TAIL =
  '(?:\\([^)]*\\)|\\[[^\\]]*\\]|https?://\\S+|\\d[\\w.]*|(?:code|cli|agent|bot|ai|assistant|sonnet|opus|haiku|fable|companion|coder|pro|max|mini|preview)\\b|[\\s.,:;_\\-—·\\[\\]()])*'

const ASSISTANT_NAME = new RegExp(`^${ASSISTANT}\\b${TAIL}$`, 'i')

// Only whole-line credit, so prose about an assistant ("the title Claude generated is truncated")
// is not a finding.
const TOOL_SIGNATURE = new RegExp(
  `^[\\s>*_🤖-]*(?:generated|written|created|made|authored)\\s+(?:with|by)\\s+\\[?${ASSISTANT}\\b${TAIL}$`,
  'iu'
)

// Trailer keys that assign authorship. Capitalization and inner spacing are free-form because a
// tool may emit any of them; `Claude-Session` is absent on purpose.
const CREDIT_TRAILER =
  /^[ \t]*(co[ \t-]*authored[ \t-]*by|signed[ \t-]*off[ \t-]*by|assisted[ \t-]*by|generated[ \t-]*by|authored[ \t-]*by|created[ \t-]*by)[ \t]*:[ \t]*(.+)$/i

// A vendor's no-reply address, not the vendor's domain: people with @anthropic.com addresses
// commit here as themselves.
const ASSISTANT_ADDRESSES = [
  /^no-?reply@(?:anthropic|openai|x\.ai|cursor|cognition|ampcode|sourcegraph|commandcode)\b/i,
  // Full addresses, never a bare vendor domain: `devin@appleidimagination.com` in this history
  // belongs to a person called Devin, and `nwparker@anthropic.com` to a person at Anthropic.
  /^(?:cursoragent@cursor\.com|amp@ampcode\.com|aider@aider\.chat)$/i,
  /^(?:\d+\+)?(?:claude|codex|copilot|cursor|devin-ai-integration|gemini-cli|google-labs-jules|chatgpt-codex-connector)(?:\[bot\])?@users\.noreply\.github\.com$/i
]

/** @param {string} identity */
function machineAuthorReason(identity) {
  const email = /<([^>]*)>/.exec(identity)?.[1].trim() ?? ''
  const name = identity.replace(/<[^>]*>/, '').trim()
  if (email !== '' && ASSISTANT_ADDRESSES.some((pattern) => pattern.test(email))) {
    return `<${email}> is an AI assistant address`
  }
  if (ASSISTANT_NAME.test(name)) {
    return `"${name}" is an AI assistant identity`
  }
  return null
}

/**
 * @param {string} message
 * @returns {{ lineNumber: number, line: string, reason: string }[]}
 */
export function findAiAttribution(message) {
  const findings = []
  // Split on every line ending: a stray CR left in the line would make `$` miss the trailer.
  message.split(/\r\n|[\r\n]/).forEach((line, index) => {
    const trailer = CREDIT_TRAILER.exec(line)
    const reason = trailer
      ? machineAuthorReason(trailer[2])
      : TOOL_SIGNATURE.test(line)
        ? 'the line credits an AI tool for the change'
        : null
    if (reason !== null) {
      findings.push({ lineNumber: index + 1, line: line.trim(), reason })
    }
  })
  return findings
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function resolves(revision) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])
    return true
  } catch {
    return false
  }
}

const RECORD = '\u0001'
const FIELD = '\u0002'

/**
 * The PR's own commits: reachable from HEAD, not from the merge target, and not from upstream.
 *
 * Both exclusions matter. Without the base, the gate would re-judge all of main and stay red
 * forever over the two commits that already landed. Without upstream, a sync PR would import
 * ~2800 upstream commits — many of them legitimately co-authored by an assistant in a repo that
 * allows it — and turn every sync red. A missing upstream ref is not fatal: `main` is still
 * excluded, which is the case this gate exists for.
 *
 * @param {string} base
 * @param {string[]} upstreamRefs
 */
function prCommits(base, upstreamRefs) {
  const excluded = [base, ...upstreamRefs.filter(resolves)].map((ref) => `^${ref}`)
  const output = git([
    'log',
    `--format=${RECORD}%H${FIELD}%h${FIELD}%s${FIELD}%B`,
    'HEAD',
    ...excluded
  ])
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, shortSha, subject, body] = record.split(FIELD)
      return { sha, shortSha, subject, message: body ?? '' }
    })
}

function main() {
  // An empty argv slot arrives as '' from `pnpm run … -- "$SHA"` when the SHA is missing, and a
  // bare '--' survives on some runners.
  const requested = (process.argv.slice(2).find((argument) => argument !== '--') ?? '').trim()
  const base = requested === '' ? 'origin/main' : requested
  const upstreamRefs = (process.env.ORCA_AI_ATTRIBUTION_UPSTREAM_REFS ?? 'upstream/main')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)

  // Why skip instead of fail: a checkout without the merge target cannot bound the range, and a
  // gate that fails there teaches people to feed it any ref until it goes quiet.
  if (!resolves(base)) {
    console.log(`AI attribution check skipped — ${base} is not present in this checkout.`)
    return 0
  }

  const commits = prCommits(base, upstreamRefs)
  const offenders = commits
    .map((commit) => ({ ...commit, findings: findAiAttribution(commit.message) }))
    .filter((commit) => commit.findings.length > 0)

  if (offenders.length === 0) {
    console.log(
      `AI attribution check OK — ${commits.length} commit(s) since ${base}, none credits an AI.`
    )
    return 0
  }

  console.error(`AI attribution found in ${offenders.length} of ${commits.length} commit(s):\n`)
  for (const commit of offenders) {
    console.error(`  ${commit.shortSha} ${commit.subject}`)
    for (const finding of commit.findings) {
      console.error(`    message line ${finding.lineNumber}: ${finding.line}`)
      console.error(`      ${finding.reason}`)
    }
  }
  console.error(
    '\nThis repo credits people, not tools, and a squash merge copies these lines into main.' +
      '\nDrop each line above and force-push:' +
      '\n  git commit --amend   (tip commit only)' +
      `\n  git rebase -i ${base}   (mark every commit listed above as "reword")` +
      '\nA human co-author stays valid, and the Claude-Session trailer is provenance rather than' +
      '\ncredit — neither is reported here.'
  )
  return 1
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  process.exit(main())
}
