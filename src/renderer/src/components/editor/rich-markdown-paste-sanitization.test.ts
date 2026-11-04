// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { createRichMarkdownExtensions } from './rich-markdown-extensions'
import { createRichMarkdownEditorCodec } from './rich-markdown-source-transport'

const TEST_KEY = '0123456789abcdef0123456789abcdef'

// Why: tiptap's schema declares no attribute `validate`, so a test-only wrapper node is the only
// way to reach the data-pm-slice branch GHSA-c8x8-7fp4-3x9w patched in prosemirror-view 1.42.3.
const ValidatedWrapper = Node.create({
  name: 'validatedWrapper',
  group: 'block',
  content: 'block+',
  addAttributes() {
    return { tone: { default: 'plain', validate: 'string' } }
  },
  parseHTML() {
    return [{ tag: 'section[data-validated-wrapper]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', { ...HTMLAttributes, 'data-validated-wrapper': '' }, 0]
  }
})

const editors: Editor[] = []

function createEditor(
  extraExtensions: Node[] = [],
  onPastedSlice?: (slice: Slice) => void
): Editor {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = new Editor({
    element: root,
    extensions: [
      ...createRichMarkdownExtensions({ codec: createRichMarkdownEditorCodec(TEST_KEY) }),
      ...extraExtensions
    ],
    content: '',
    contentType: 'markdown',
    editorProps: {
      transformPasted: (slice) => {
        onPastedSlice?.(slice)
        return slice
      }
    }
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
  document.body.innerHTML = ''
  delete (window as { __orcaPasteXss?: unknown }).__orcaPasteXss
})

describe('rich markdown HTML paste', () => {
  it('drops script, inline handlers and javascript: links from pasted HTML', () => {
    const editor = createEditor()

    editor.view.pasteHTML(
      '<p>safe <a href="javascript:window.__orcaPasteXss=1">link</a></p>' +
        '<img src="x" onerror="window.__orcaPasteXss=2">' +
        '<script>window.__orcaPasteXss=3</script>'
    )

    const html = editor.view.dom.innerHTML
    expect(editor.getText()).toContain('safe link')
    expect(html).not.toMatch(/onerror|<script|javascript:/i)
    expect((window as { __orcaPasteXss?: unknown }).__orcaPasteXss).toBeUndefined()
  })

  // Why: an open wrapper is fitted away on insert, so assert on the slice the clipboard parser built.
  function pastedWrapperTypes(tone: unknown): string[] {
    let pasted: Slice | undefined
    const editor = createEditor([ValidatedWrapper], (slice) => {
      pasted = slice
    })
    const context = JSON.stringify(['validatedWrapper', { tone }])
    editor.view.pasteHTML(`<p data-pm-slice='1 1 ${context}'>wrapped</p>`)
    expect(pasted?.content.textBetween(0, pasted.content.size)).toBe('wrapped')
    return pasted ? [pasted.content.firstChild!.type.name] : []
  }

  it('refuses a data-pm-slice wrapper whose attrs fail schema validation', () => {
    expect(pastedWrapperTypes(42)).toEqual(['paragraph'])
  })

  it('keeps a data-pm-slice wrapper whose attrs pass validation', () => {
    expect(pastedWrapperTypes('loud')).toEqual(['validatedWrapper'])
  })
})
