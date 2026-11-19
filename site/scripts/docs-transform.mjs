import path from 'node:path'

// Tags that may appear as real HTML in the source docs; any other <word> in prose is
// a placeholder like <scene> and would vanish as an unknown element.
const HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'details',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'ol',
  'p',
  'picture',
  'pre',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])
const IMAGE_EXT = /\.(png|gif|jpe?g|svg|webp)$/i

function quote(value) {
  return JSON.stringify(value)
}

function isExternal(target) {
  return /^(?:[a-z]+:|#|\/\/)/i.test(target)
}

function resolveTarget(target, sourcePath, opts, images) {
  if (isExternal(target)) {
    return target
  }
  const [filePart, anchor = ''] = target.split('#')
  const hash = anchor ? `#${anchor}` : ''
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), filePart))
  const route = opts.routes.get(repoPath)
  if (route) {
    return `${opts.base}/${route}/${hash}`
  }
  if (IMAGE_EXT.test(repoPath)) {
    images.push(repoPath)
    return `${opts.base}/media/${repoPath}`
  }
  return `${opts.repoUrl}/blob/main/${repoPath}${hash}`
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// A screenshot on a line of its own with a `.dark` sibling shows the copy that matches the theme.
function themedShot(line, sourcePath, opts, images) {
  const match = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
  if (!match || isExternal(match[2]) || !opts.darkVariant) {
    return null
  }
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), match[2]))
  const dark = IMAGE_EXT.test(repoPath) ? opts.darkVariant(repoPath) : null
  if (!dark) {
    return null
  }
  images.push(repoPath, dark)
  // Why half: the capture spec shoots at 2x, so this shows the UI at its own size.
  const size = opts.imageSize?.(repoPath)
  const dims = size
    ? ` width="${Math.round(size.width / 2)}" height="${Math.round(size.height / 2)}"`
    : ''
  const img = (file, hiddenIn) =>
    `<img class="orca-shot ${hiddenIn}:sl-hidden" src="${opts.base}/media/${file}" alt="${escapeAttr(match[1])}"${dims} loading="lazy" />`
  return img(repoPath, 'dark') + img(dark, 'light')
}

function escapePlaceholderTags(text) {
  return text.replace(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g, (match, slash, name, rest) =>
    HTML_TAGS.has(name.toLowerCase()) ? match : `&lt;${slash}${name}${rest}&gt;`
  )
}

// An inline code span with a flag, as HTML with each flag and short word kept whole: a wrapped
// line must never split `--past-busy` after `--`. Punctuation goes out as entities so Markdown's
// smart punctuation cannot turn `--` into a dash or `"` into a curly quote.
function flagSpan(span) {
  const inner = /^`([^`]+)`$/.exec(span)?.[1]
  if (!inner || !/--\w/.test(inner)) {
    return span
  }
  const words = inner
    .replace(/\s*\n\s*/g, ' ')
    .split(/( +)/)
    .map((word) => {
      const text = word.replace(/[^\w\s]/g, (ch) => `&#${ch.codePointAt(0)};`)
      return word.trim() && (word.includes('--') || word.length <= 20)
        ? `<span class="nowrap">${text}</span>`
        : text
    })
  return `<code dir="auto">${words.join('')}</code>`
}

// Rewrites one prose line; inline code spans keep their text.
function rewriteProse(line, sourcePath, opts, images) {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, index) => {
      if (index % 2 === 1) {
        return flagSpan(part)
      }
      const linked = part
        .replace(
          /(\]\()([^)\s]+)(\))/g,
          (_m, open, target, close) =>
            `${open}${resolveTarget(target, sourcePath, opts, images)}${close}`
        )
        .replace(
          /^(\s*\[[^\]]+\]:\s*)(\S+)/,
          (_m, label, target) => `${label}${resolveTarget(target, sourcePath, opts, images)}`
        )
      return escapePlaceholderTags(linked)
    })
    .join('')
}

/**
 * Turns a repo Markdown doc into a Starlight page: H1 → frontmatter title, relative
 * links → site routes or GitHub, images → /media paths the caller copies.
 */
export function transformDoc(source, sourcePath, opts) {
  const images = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let title = path.posix.basename(sourcePath, '.md')
  let fence = null
  const body = []
  let titleTaken = false
  // Why gather lines: a code span can run onto the next line, and a line-by-line split would pair
  // its backtick with the next span's. A span never crosses a blank line.
  let prose = []
  const flush = () => {
    if (prose.length) {
      const text = prose.join('\n')
      body.push(
        themedShot(text, sourcePath, opts, images) ?? rewriteProse(text, sourcePath, opts, images)
      )
      prose = []
    }
  }
  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      body.push(line)
      if (fenceMatch && fenceMatch[1].startsWith(fence)) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      flush()
      fence = fenceMatch[1]
      body.push(line)
      continue
    }
    const h1 = /^#\s+(.+?)\s*$/.exec(line)
    if (h1 && !titleTaken && !prose.length) {
      title = h1[1]
      titleTaken = true
      continue
    }
    if (!line.trim()) {
      flush()
      body.push(line)
      continue
    }
    prose.push(line)
    if ((prose.join('\n').match(/`/g) ?? []).length % 2 === 0) {
      flush()
    }
  }
  flush()
  const frontmatter = [
    '---',
    `title: ${quote(title)}`,
    `editUrl: ${quote(`${opts.repoUrl}/edit/main/${sourcePath}`)}`,
    '---'
  ].join('\n')
  const markdown = `${frontmatter}\n${body.join('\n').replace(/^\n+/, '\n')}`
  return { markdown, images, title }
}
