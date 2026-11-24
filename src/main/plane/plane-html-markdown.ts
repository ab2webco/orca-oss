// Plane work-item descriptions and comment bodies are HTML (description_html),
// not Jira's ADF — this is a separate, purpose-built HTML<->Markdown pair and
// must never import from ../jira/adf-markdown.

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'"
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#39|amp|lt|gt|quot|apos);/g,
    (match, name: string) => HTML_ENTITIES[name] ?? match
  )
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

/** Converts Plane's rich-text HTML into Markdown. Tolerant of non-string input. */
export function planeHtmlToMarkdown(html: string): string {
  if (typeof html !== 'string' || html.length === 0) {
    return ''
  }

  // Why: decoded code/link content can contain literal '<'/'>' that must not
  // be mistaken for HTML tags by later passes, so it is stashed behind a
  // placeholder token until the very end.
  const placeholders: string[] = []
  function stash(value: string): string {
    const token = `\0P${placeholders.length}\0`
    placeholders.push(value)
    return token
  }

  let work = html

  // Why [^>]*: Plane's TipTap editor emits attributed tags
  // (<h3 class="editor-heading-block" data-id="...">, <p class="...">,
  // <code class="..." spellcheck="false">). Matching only bare tags let
  // stripTags drop every block with no separator, collapsing the whole
  // description into one run-on line — so every opening tag tolerates attrs.
  work = work.replace(
    /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, code: string) => stash(`\n\n\`\`\`\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n\n`)
  )
  work = work.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, code: string) =>
    stash(`\`${decodeHtmlEntities(code)}\``)
  )
  work = work.replace(
    /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, text: string) =>
      stash(`[${decodeHtmlEntities(stripTags(text))}](${decodeHtmlEntities(href)})`)
  )
  work = work.replace(
    /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_match, _tag: string, inner: string) => `**${inner}**`
  )
  work = work.replace(
    /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_match, _tag: string, inner: string) => `*${inner}*`
  )
  work = work.replace(/<br\s*\/?>/gi, '\n')

  work = work.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (item) => `- ${item[1].trim()}`
    )
    return stash(`\n\n${items.join('\n')}\n\n`)
  })
  work = work.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (item, index) => `${index + 1}. ${item[1].trim()}`
    )
    return stash(`\n\n${items.join('\n')}\n\n`)
  })
  work = work.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner: string) => {
    const text = inner.replace(/<\/?p\b[^>]*>/gi, '').trim()
    const quoted = text
      .split('\n')
      .map((line) => `> ${line}`.trimEnd())
      .join('\n')
    return stash(`\n\n${quoted}\n\n`)
  })
  work = work.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match, level: string, inner: string) =>
      stash(`\n\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`)
  )
  work = work.replace(
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi,
    (_match, inner: string) => `\n\n${inner.trim()}\n\n`
  )

  work = stripTags(work)
  work = decodeHtmlEntities(work)
  // Why: placeholders can nest (a stashed block contains stashed inline code/links),
  // so a single pass leaves inner tokens; loop until no sentinel remains.
  let restorePass = 0
  while (work.includes('\0') && restorePass < 50) {
    work = work.replace(/\0P(\d+)\0/g, (_match, index: string) => placeholders[Number(index)] ?? '')
    restorePass += 1
  }

  return work
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function convertInlineMarkdown(text: string): string {
  // Why: code spans and link URLs are stashed so the emphasis rules never see
  // their '_' and '*'; restored once every inline rule has run.
  const placeholders: string[] = []
  const sources: string[] = []
  function stash(value: string, source = value): string {
    const token = `\0${placeholders.length}\0`
    placeholders.push(value)
    sources.push(source)
    return token
  }
  const resolve = (value: string, from: string[]): string =>
    value.replace(/\0(\d+)\0/g, (_match, index: string) => from[Number(index)] ?? '')

  let out = escapeHtml(text.replace(/\0/g, ''))
  out = out.replace(/`([^`]+)`/g, (match, code: string) => stash(`<code>${code}</code>`, match))
  // Why: a code span inside a URL goes back to its backtick source, so no token nests.
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${stash(resolve(href, sources))}">${label}</a>`
  )
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  // Why: intra-word underscores (snake_case) stay literal, as in CommonMark.
  out = out.replace(/(?<![\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, '<em>$1</em>')
  return resolve(out, placeholders)
}

function convertBlockToHtml(block: string): string {
  const trimmed = block.trim()
  if (!trimmed) {
    return ''
  }

  const codeMatch = /^```\n?([\s\S]*?)\n?```$/.exec(trimmed)
  if (codeMatch) {
    return `<pre><code>${escapeHtml(codeMatch[1])}</code></pre>`
  }

  const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed)
  if (headingMatch) {
    const level = headingMatch[1].length
    return `<h${level}>${convertInlineMarkdown(headingMatch[2])}</h${level}>`
  }

  const lines = trimmed.split('\n')

  if (lines.every((line) => line.startsWith('>'))) {
    const inner = lines.map((line) => line.replace(/^>\s?/, '')).join('\n')
    return `<blockquote><p>${convertInlineMarkdown(inner).replace(/\n/g, '<br>')}</p></blockquote>`
  }
  if (lines.every((line) => /^[-*]\s+/.test(line))) {
    const items = lines.map(
      (line) => `<li>${convertInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`
    )
    return `<ul>${items.join('')}</ul>`
  }
  if (lines.every((line) => /^\d+\.\s+/.test(line))) {
    const items = lines.map(
      (line) => `<li>${convertInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`
    )
    return `<ol>${items.join('')}</ol>`
  }

  return `<p>${lines.map(convertInlineMarkdown).join('<br>')}</p>`
}

/** Converts Markdown into Plane's rich-text HTML shape. Tolerant of non-string input. */
export function markdownToPlaneHtml(md: string): string {
  if (typeof md !== 'string' || md.length === 0) {
    return ''
  }

  return md
    .trim()
    .split(/\n{2,}/)
    .map(convertBlockToHtml)
    .filter((block) => block.length > 0)
    .join('')
}
