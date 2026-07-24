// Removes agent-authored AI provenance/attribution footers from a work-item
// body (description or comment) before it is written to Plane, when the user
// opts to suppress them. Orca never adds these itself — an agent writes them as
// content, e.g. "_Planeado con Claude Code (verificación read-only...)._" or
// "_Refined with Codex_". We target only a standalone emphasized line that both
// names an AI tool and carries a provenance verb, so ordinary prose that merely
// mentions a tool (or an unrelated italic aside) is left untouched.

const AI_TOOL_RE =
  /\b(claude(?:\s+code)?|codex|gpt(?:[-\s]?\d\S*)?|copilot|gemini|llama|glm(?:[-\s]?\S+)?|z\.ai)\b/i

const PROVENANCE_VERB_RE =
  /(\bplane[ao]d[oa]?\b|\brefinad[oa]\b|\bgenerad[oa]\b|\bcread[oa]\b|\bescrit[oa]\b|\bplan\b|\bplanned\b|\brefined\b|\bgenerated\b|\bwritten\b|\bcreated\b|\bauthored\b|\bassisted\b|verificaci[oó]n|\bverified\b|con ayuda de|with help from)/i

// A line whose trimmed text is wrapped in emphasis (_..._ / *...* / __...__ /
// **...**), allowing a single trailing sentence period after the close marker.
const EMPHASIZED_LINE_RE = /^[_*]{1,2}[\s\S]+[_*]{1,2}\.?$/

function isAttributionLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 3 || !EMPHASIZED_LINE_RE.test(trimmed)) {
    return false
  }
  // Why: strip the emphasis markers before matching — a leading '_' is a word
  // character, so `\b` before "Planeado"/"Refinado" would otherwise never fire.
  const inner = trimmed
    .replace(/^[_*]{1,2}/, '')
    .replace(/[_*]{1,2}\.?$/, '')
    .trim()
  return AI_TOOL_RE.test(inner) && PROVENANCE_VERB_RE.test(inner)
}

/**
 * Strips AI provenance/attribution footer lines from Markdown. Non-string input
 * and text with no such line are returned unchanged (aside from collapsing the
 * blank lines a removal leaves behind).
 */
export function stripAiAttribution(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.length === 0) {
    return markdown
  }
  const lines = markdown.split('\n')
  const kept = lines.filter((line) => !isAttributionLine(line))
  if (kept.length === lines.length) {
    return markdown
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
