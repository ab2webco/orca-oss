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

  it('keeps a code span with an identifier that has two underscores as one code element', () => {
    expect(markdownToPlaneHtml('Call `read_plane_issue` now.')).toBe(
      '<p>Call <code>read_plane_issue</code> now.</p>'
    )
  })

  it('keeps two backticked identifiers with one underscore each on one line plain', () => {
    expect(markdownToPlaneHtml('Both `work_item` and `state_id` change.')).toBe(
      '<p>Both <code>work_item</code> and <code>state_id</code> change.</p>'
    )
  })

  it('leaves asterisks inside backticks untouched', () => {
    expect(markdownToPlaneHtml('Match `src/*.ts` and `*.md` files.')).toBe(
      '<p>Match <code>src/*.ts</code> and <code>*.md</code> files.</p>'
    )
    expect(markdownToPlaneHtml('Use `**/*.ts` here.')).toBe('<p>Use <code>**/*.ts</code> here.</p>')
  })

  it('does not turn a link inside a code span into an anchor', () => {
    expect(markdownToPlaneHtml('Write `[a](b)` literally.')).toBe(
      '<p>Write <code>[a](b)</code> literally.</p>'
    )
  })

  it('keeps intra-word underscores literal outside code spans', () => {
    expect(markdownToPlaneHtml('The snake_case_name and foo_bar stay.')).toBe(
      '<p>The snake_case_name and foo_bar stay.</p>'
    )
    expect(markdownToPlaneHtml('An _emphasized_ word.')).toBe('<p>An <em>emphasized</em> word.</p>')
  })

  it('keeps underscores in a link URL literal', () => {
    expect(markdownToPlaneHtml('See [the doc](https://x.test/a_b/c_d).')).toBe(
      '<p>See <a href="https://x.test/a_b/c_d">the doc</a>.</p>'
    )
  })

  it('keeps underscore and asterisk pairs in a link URL out of emphasis', () => {
    expect(markdownToPlaneHtml('[q](https://x.test/?q=_x_)')).toBe(
      '<p><a href="https://x.test/?q=_x_">q</a></p>'
    )
    expect(markdownToPlaneHtml('[q](https://x.test/?a=*b*)')).toBe(
      '<p><a href="https://x.test/?a=*b*">q</a></p>'
    )
  })

  it('keeps a code span inside a link URL as its backtick source', () => {
    expect(markdownToPlaneHtml('[docs](`http://x_y`)')).toBe(
      '<p><a href="`http://x_y`">docs</a></p>'
    )
    expect(markdownToPlaneHtml('[a](b `c` d)')).toBe('<p><a href="b `c` d">a</a></p>')
  })

  it('escapes a double quote in a link URL so it stays inside href', () => {
    expect(markdownToPlaneHtml('[x](https://x.test/a"onmouseover="alert(1))')).toBe(
      '<p><a href="https://x.test/a&quot;onmouseover=&quot;alert(1">x</a>)</p>'
    )
    expect(markdownToPlaneHtml('[q](https://x.test/?q="a b")')).toBe(
      '<p><a href="https://x.test/?q=&quot;a b&quot;">q</a></p>'
    )
  })

  it('does not open emphasis at an underscore that follows a word character', () => {
    expect(markdownToPlaneHtml('a_b_ c')).toBe('<p>a_b_ c</p>')
  })

  it('never leaves a placeholder NUL in the output', () => {
    const inputs = [
      '[docs](`http://x_y`)',
      '[a](b `c` d)',
      '[`a_b`](`c_d`) and `e` [f](g)',
      '**`x`** _`y`_ [z](`w`)',
      'nul \0 in \u00000\u0000 text'
    ]
    for (const input of inputs) {
      expect(markdownToPlaneHtml(input)).not.toContain('\0')
    }
  })

  it('still applies emphasis around and next to code spans', () => {
    expect(markdownToPlaneHtml('**bold `a_b_c`** and *it* with [`x_y_z`](https://x.test)')).toBe(
      '<p><strong>bold <code>a_b_c</code></strong> and <em>it</em> with <a href="https://x.test"><code>x_y_z</code></a></p>'
    )
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

  it('keeps a double quote in a link URL and in text', () => {
    const original = 'Say "hi" at [q](https://x.test/?q="a b")'
    expect(planeHtmlToMarkdown(markdownToPlaneHtml(original))).toBe(original)
  })

  it.each([
    ['bullet list', '- say "hi"\n- "two"'],
    ['ordered list', '1. say "hi"'],
    ['heading', '## The "quoted" title'],
    ['blockquote', '> she said "hi"']
  ])('keeps a double quote in a %s', (_kind, original) => {
    expect(planeHtmlToMarkdown(markdownToPlaneHtml(original))).toBe(original)
  })
})
