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

function escapePlaceholderTags(text) {
  return text.replace(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g, (match, slash, name, rest) =>
    HTML_TAGS.has(name.toLowerCase()) ? match : `&lt;${slash}${name}${rest}&gt;`
  )
}

// Rewrites one prose line, leaving inline code spans as they are.
function rewriteProse(line, sourcePath, opts, images) {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, index) => {
      if (index % 2 === 1) {
        return part
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
      fence = fenceMatch[1]
      body.push(line)
      continue
    }
    const h1 = /^#\s+(.+?)\s*$/.exec(line)
    if (h1 && !titleTaken) {
      title = h1[1]
      titleTaken = true
      continue
    }
    body.push(rewriteProse(line, sourcePath, opts, images))
  }
  const frontmatter = [
    '---',
    `title: ${quote(title)}`,
    `editUrl: ${quote(`${opts.repoUrl}/edit/main/${sourcePath}`)}`,
    '---'
  ].join('\n')
  const markdown = `${frontmatter}\n${body.join('\n').replace(/^\n+/, '\n')}`
  return { markdown, images, title }
}
