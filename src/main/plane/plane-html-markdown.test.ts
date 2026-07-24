import { describe, expect, it } from 'vitest'
import { markdownToPlaneHtml, planeHtmlToMarkdown } from './plane-html-markdown'

describe('planeHtmlToMarkdown', () => {
  it('returns empty string for null, undefined, empty, and non-string input', () => {
    expect(planeHtmlToMarkdown(null as unknown as string)).toBe('')
    expect(planeHtmlToMarkdown(undefined as unknown as string)).toBe('')
    expect(planeHtmlToMarkdown('')).toBe('')
    expect(planeHtmlToMarkdown(42 as unknown as string)).toBe('')
    expect(planeHtmlToMarkdown({} as unknown as string)).toBe('')
  })

  it('converts a heading, paragraph with inline marks, list, blockquote, and code block', () => {
    const html =
      '<h1>Title</h1>' +
      '<p>Some <strong>bold</strong> and <em>italic</em> text.</p>' +
      '<ul><li>item one</li><li>item two</li></ul>' +
      '<blockquote><p>a quote</p></blockquote>' +
      '<pre><code>code here</code></pre>'

    const md = planeHtmlToMarkdown(html)

    expect(md).toContain('# Title')
    expect(md).toContain('Some **bold** and *italic* text.')
    expect(md).toContain('- item one')
    expect(md).toContain('- item two')
    expect(md).toContain('> a quote')
    expect(md).toContain('```\ncode here\n```')
  })

  it('converts an ordered list and a link', () => {
    const html =
      '<ol><li>first</li><li>second</li></ol><p>See <a href="https://example.com">docs</a>.</p>'
    const md = planeHtmlToMarkdown(html)

    expect(md).toContain('1. first')
    expect(md).toContain('2. second')
    expect(md).toContain('[docs](https://example.com)')
  })

  it('restores nested placeholders inside list items without leaking sentinels', () => {
    const html =
      '<ul><li>uses <code>currentUser()</code> and a <a href="https://x.io">link</a></li>' +
      '<li>see <code>state.group</code></li></ul>'
    const md = planeHtmlToMarkdown(html)

    expect(md).toContain('- uses `currentUser()` and a [link](https://x.io)')
    expect(md).toContain('- see `state.group`')
    // No leaked NULL sentinels (the nested-placeholder bug rendered these as U+FFFD).
    expect(md).not.toContain(String.fromCharCode(0))
  })

  it('decodes HTML entities', () => {
    const html = '<p>Fish &amp; chips &lt;tag&gt; &quot;quoted&quot;</p>'
    expect(planeHtmlToMarkdown(html)).toContain('Fish & chips <tag> "quoted"')
  })

  it('converts Plane editor tags that carry class/data attributes', () => {
    // Plane's rich-text editor (TipTap) emits attributed tags, e.g.
    // <h3 class="editor-heading-block" data-id="...">, <p class="...">,
    // <code class="...">. The converter must still recognize them; otherwise
    // stripTags drops the tag with no block break and the whole description
    // collapses into one run-on line ("Bugorca plane search...").
    const html =
      '<h3 class="editor-heading-block" data-id="a1">Bug</h3>' +
      '<p class="editor-paragraph-block" data-id="b2">' +
      '<code class="rounded-sm bg-layer-3" spellcheck="false">orca plane search</code>' +
      ' devuelve <strong>todos</strong> los items.</p>' +
      '<h3 class="editor-heading-block" data-id="c3">Fix</h3>' +
      '<p class="editor-paragraph-block" data-id="d4">Filtrado client-side.</p>'

    const md = planeHtmlToMarkdown(html)

    expect(md).toContain('### Bug')
    expect(md).toContain('### Fix')
    expect(md).toContain('`orca plane search`')
    expect(md).toContain('**todos**')
    // The heading must not be glued to the following paragraph text.
    expect(md).not.toContain('Bugorca')
    expect(md).not.toContain('.Fix')
  })

  it('converts attributed list and pre/code blocks', () => {
    const html =
      '<ul class="list-block"><li data-id="1">item one</li><li data-id="2">item two</li></ul>' +
      '<pre class="code-block"><code class="language-ts">const x = 1</code></pre>'
    const md = planeHtmlToMarkdown(html)

    expect(md).toContain('- item one')
    expect(md).toContain('- item two')
    expect(md).toContain('```\nconst x = 1\n```')
  })

  it('never imports the Jira ADF conversion module', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./plane-html-markdown.ts', import.meta.url), 'utf-8')
    )
    expect(source).not.toMatch(/from\s+['"][^'"]*adf-markdown['"]/)
  })
})

describe('markdownToPlaneHtml', () => {
  it('returns empty string for null, undefined, empty, and non-string input', () => {
    expect(markdownToPlaneHtml(null as unknown as string)).toBe('')
    expect(markdownToPlaneHtml(undefined as unknown as string)).toBe('')
    expect(markdownToPlaneHtml('')).toBe('')
    expect(markdownToPlaneHtml(7 as unknown as string)).toBe('')
  })

  it('converts headings, bold/italic, and paragraphs to HTML', () => {
    const html = markdownToPlaneHtml('# Title\n\nSome **bold** and *italic* text.')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
  })

  it('converts unordered and ordered lists', () => {
    const html = markdownToPlaneHtml('- item one\n- item two')
    expect(html).toBe('<ul><li>item one</li><li>item two</li></ul>')

    const orderedHtml = markdownToPlaneHtml('1. first\n2. second')
    expect(orderedHtml).toBe('<ol><li>first</li><li>second</li></ol>')
  })

  it('converts a code fence and a blockquote', () => {
    expect(markdownToPlaneHtml('```\ncode here\n```')).toBe('<pre><code>code here</code></pre>')
    expect(markdownToPlaneHtml('> a quote')).toBe('<blockquote><p>a quote</p></blockquote>')
  })

  it('escapes HTML-significant characters', () => {
    const html = markdownToPlaneHtml('Fish & chips <tag>')
    expect(html).toBe('<p>Fish &amp; chips &lt;tag&gt;</p>')
  })
})

describe('planeHtmlToMarkdown <-> markdownToPlaneHtml round-trip', () => {
  it('preserves structure across a multi-line document', () => {
    const original =
      '# Title\n\n' +
      'Some **bold** and *italic* text.\n\n' +
      '- item one\n- item two\n\n' +
      '> a quote\n\n' +
      '```\ncode here\n```'

    const html = markdownToPlaneHtml(original)
    const roundTripped = planeHtmlToMarkdown(html)

    expect(roundTripped).toContain('# Title')
    expect(roundTripped).toContain('Some **bold** and *italic* text.')
    expect(roundTripped).toContain('- item one')
    expect(roundTripped).toContain('- item two')
    expect(roundTripped).toContain('> a quote')
    expect(roundTripped).toContain('```\ncode here\n```')
  })
})
