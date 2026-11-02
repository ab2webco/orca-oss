// Why: the composer's footer hint; the trust prompt's `› 1. Yes` option never draws it.
const CODEX_COMPOSER_FOOTER = '? for shortcuts'

/** Index of Codex's ready prompt in lowercased terminal text, or null when none is visible. */
export function findCodexReadyPromptIndex(normalized: string): number | null {
  const headerIndex = normalized.lastIndexOf('openai codex')
  if (headerIndex === -1) {
    return null
  }
  const readySegment = normalized.slice(headerIndex)
  // Why: Codex prints permissions only in YOLO mode; the stable ready header is OpenAI Codex + model + directory.
  if (readySegment.includes('model:') && readySegment.includes('directory:')) {
    return headerIndex
  }
  // Why (ORCA-936): 0.166.0 dropped model/directory; its ready screen is the `›` composer and footer.
  const footerIndex = normalized.lastIndexOf(CODEX_COMPOSER_FOOTER)
  if (footerIndex < headerIndex) {
    return null
  }
  return normalized.slice(headerIndex, footerIndex).includes('›') ? footerIndex : null
}
