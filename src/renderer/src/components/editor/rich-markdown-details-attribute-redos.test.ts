// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createInlineMarkdownSpec, Editor, parseAttributes } from '@tiptap/core'
import { createRichMarkdownExtensions } from './rich-markdown-extensions'
import { createRichMarkdownEditorCodec } from './rich-markdown-source-transport'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function loadMarkdownMs(markdown: string): { ms: number; editor: Editor } {
  const started = performance.now()
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichMarkdownExtensions({
      codec: createRichMarkdownEditorCodec('0123456789abcdef0123456789abcdef')
    }),
    content: markdown,
    contentType: 'markdown'
  })
  editors.push(editor)
  return { ms: performance.now() - started, editor }
}

// GHSA-j95f-988m-3j2f, fixed by config/patches/@tiptap__core@3.22.5.patch until ORCA-1035 bumps tiptap.
// DetailsSummary/DetailsContent keep tiptap's block attribute parser, so such a file hung the renderer.
// Why 1000 ms: the patched parsers take ~10 ms on these 41 KB inputs; unpatched 3.22.5 took ~3.6 s.
describe('tiptap markdown attribute parsing', () => {
  it.each(['detailsSummary', 'detailsContent'])(
    'parses a hostile %s attribute list in linear time',
    (nodeName) => {
      const attack = `${'__QUOTED_0'.repeat(4096)}__QUOTED_0__`
      const { ms, editor } = loadMarkdownMs(`:::${nodeName} {${attack}}\n\nbody\n\n:::\n`)

      expect(editor.getText()).toContain('body')
      expect(ms).toBeLessThan(1000)
    },
    30_000
  )

  it('parses a hostile inline shortcode attribute list in linear time', () => {
    const tokenizer = createInlineMarkdownSpec({
      nodeName: 'probe',
      selfClosing: true
    }).markdownTokenizer!
    const source = `[probe ${'a'.repeat(40_000)}]`

    const started = performance.now()
    const token = tokenizer.tokenize(source, [], {} as never)

    expect(token).toMatchObject({ attributes: {} })
    expect(performance.now() - started).toBeLessThan(1000)
  }, 30_000)

  it('still reads classes, id, quoted pairs and flags', () => {
    expect(parseAttributes(`.note #intro title="A b" _lang='en' x="1"y="2" open`)).toEqual({
      class: 'note',
      id: 'intro',
      title: 'A b',
      lang: 'en',
      x: '1',
      y: '2',
      open: true
    })
  })
})
