import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-ordered-list-exit'

const HARD_WRAPPED_MARKDOWN =
  'The store owns launch-lifetime presentation state keyed by tab id, while native\n' +
  'chat owns conversion, ordering, and transcript reconciliation through pure\n' +
  'helpers. This keeps the bridge removable later if provider-native launch\n' +
  'delivery becomes universal.\n\n' +
  '## Next section\n'

type ReflowMetrics = {
  hardBreakCount: number
  lineCount: number
  modelHardBreakCount: number
  paragraphCount: number
  sourceLineCount: number
  textContent: string
  whiteSpace: string
}

type PageEditorDocNode = {
  descendants?: (callback: (node: PageEditorDocNode, pos: number) => boolean | void) => void
  textContent?: string
  type?: { name?: string }
}

type HardWrappedFixture = {
  filePath: string
  sentinel: string
}

type PageRichMarkdownEditorElement = Element & {
  editor?: {
    commands?: {
      focus?: () => boolean
      setTextSelection?: (position: number) => boolean
    }
    state?: {
      doc?: {
        descendants?: (callback: (node: PageEditorDocNode, pos: number) => boolean) => void
      }
    }
  }
}

async function openHardWrappedFixture(
  page: Parameters<typeof waitForRichMarkdownEditor>[0],
  testInfo: { workerIndex: number }
): Promise<HardWrappedFixture> {
  const context = await getActiveWorktreeContext(page)
  const sentinel = `prose-reflow-${randomUUID()}`
  const filePath = await createMarkdownFixture(
    context,
    'prose-reflow',
    testInfo.workerIndex,
    HARD_WRAPPED_MARKDOWN.replace(
      'delivery becomes universal.',
      `delivery becomes universal. ${sentinel}`
    )
  )
  await openMarkdownFixture(page, context, filePath)
  const editor = await waitForRichMarkdownEditor(page)
  await expect(editor).toContainText(sentinel)
  return { filePath, sentinel }
}

async function getGoalParagraphMetrics(
  page: Parameters<typeof waitForRichMarkdownEditor>[0],
  sentinel: string
): Promise<ReflowMetrics> {
  return page.evaluate((sentinel) => {
    const editor = Array.from(document.querySelectorAll('.rich-markdown-editor')).find(
      (candidate) => candidate.textContent?.includes(sentinel)
    ) as PageRichMarkdownEditorElement | undefined
    if (!editor) {
      throw new Error('The hydrated rich markdown editor was not mounted')
    }

    const paragraphs = Array.from(editor.querySelectorAll('p')).filter((paragraph) =>
      paragraph.textContent?.includes(sentinel)
    )
    const paragraph = paragraphs[0]
    if (!paragraph) {
      throw new Error('Hard-wrapped paragraph was not rendered')
    }

    let modelHardBreakCount: number | null = null
    editor.editor?.state?.doc?.descendants?.((node) => {
      if (node.type?.name !== 'paragraph' || !node.textContent?.includes(sentinel)) {
        return true
      }

      modelHardBreakCount = 0
      node.descendants?.((descendant) => {
        if (descendant.type?.name === 'hardBreak') {
          modelHardBreakCount = (modelHardBreakCount ?? 0) + 1
        }
        return true
      })
      return false
    })
    if (modelHardBreakCount === null) {
      throw new Error('Hard-wrapped paragraph was not found in the editor model')
    }

    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const lineTops: number[] = []
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) {
        continue
      }
      if (!lineTops.some((top) => Math.abs(top - rect.top) < 2)) {
        lineTops.push(rect.top)
      }
    }

    return {
      hardBreakCount: paragraph.querySelectorAll('br').length,
      lineCount: lineTops.length,
      modelHardBreakCount,
      paragraphCount: paragraphs.length,
      sourceLineCount: paragraph.textContent?.split('\n').length ?? 0,
      textContent: paragraph.textContent ?? '',
      whiteSpace: window.getComputedStyle(paragraph).whiteSpace
    }
  }, sentinel)
}

async function placeCaretAtGoalParagraphEnd(
  page: Parameters<typeof waitForRichMarkdownEditor>[0],
  sentinel: string
): Promise<void> {
  await page.evaluate((sentinel) => {
    const editorElement = Array.from(document.querySelectorAll('.rich-markdown-editor')).find(
      (candidate) => candidate.textContent?.includes(sentinel)
    ) as PageRichMarkdownEditorElement | undefined
    const paragraph = Array.from(editorElement?.querySelectorAll('p') ?? []).find((candidate) =>
      candidate.textContent?.includes(sentinel)
    ) as
      | (HTMLParagraphElement & {
          pmViewDesc?: {
            posAtEnd?: number
          }
        })
      | undefined
    const selectionPosition = paragraph?.pmViewDesc?.posAtEnd
    if (!editorElement?.editor?.commands || typeof selectionPosition !== 'number') {
      throw new Error('Cannot place caret at the hard-wrapped paragraph end')
    }

    editorElement.editor.commands.setTextSelection?.(selectionPosition)
    editorElement.editor.commands.focus?.()
  }, sentinel)
}

async function placeCaretAtHeadingStart(
  page: Parameters<typeof waitForRichMarkdownEditor>[0],
  sentinel: string
): Promise<void> {
  await page.evaluate((sentinel) => {
    const editorElement = Array.from(document.querySelectorAll('.rich-markdown-editor')).find(
      (candidate) => candidate.textContent?.includes(sentinel)
    ) as PageRichMarkdownEditorElement | undefined
    const editor = editorElement?.editor
    let selectionPosition: number | null = null
    editor?.state?.doc?.descendants?.((node, pos) => {
      if (node.type?.name === 'heading' && node.textContent?.includes('Next section')) {
        selectionPosition = pos + 1
        return false
      }
      return true
    })

    if (!editor?.commands || selectionPosition === null) {
      throw new Error('Cannot place caret at the heading start')
    }

    editor.commands.setTextSelection?.(selectionPosition)
    editor.commands.focus?.()
  }, sentinel)
}

test.describe('Markdown prose reflow', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('hard-wrapped prose reflows as one document paragraph', async ({ orcaPage }, testInfo) => {
    let filePath: string | null = null

    try {
      const fixture = await openHardWrappedFixture(orcaPage, testInfo)
      filePath = fixture.filePath
      const metrics = await getGoalParagraphMetrics(orcaPage, fixture.sentinel)

      expect(metrics.paragraphCount).toBe(1)
      expect(metrics.sourceLineCount).toBe(4)
      expect(metrics.whiteSpace).toBe('normal')
      expect(metrics.lineCount).toBeLessThan(metrics.sourceLineCount)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('deleting an inserted empty paragraph keeps hard-wrapped prose reflowing', async ({
    orcaPage
  }, testInfo) => {
    let filePath: string | null = null

    try {
      const fixture = await openHardWrappedFixture(orcaPage, testInfo)
      filePath = fixture.filePath
      await placeCaretAtGoalParagraphEnd(orcaPage, fixture.sentinel)
      await orcaPage.keyboard.press('Enter')
      await orcaPage.keyboard.press('Backspace')

      const metrics = await getGoalParagraphMetrics(orcaPage, fixture.sentinel)

      expect(metrics.hardBreakCount).toBe(0)
      expect(metrics.modelHardBreakCount).toBe(0)
      expect(metrics.paragraphCount).toBe(1)
      expect(metrics.sourceLineCount).toBe(4)
      expect(metrics.whiteSpace).toBe('normal')
      expect(metrics.lineCount).toBeLessThan(metrics.sourceLineCount)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('deleting slash text then the empty paragraph keeps hard-wrapped prose reflowing', async ({
    orcaPage
  }, testInfo) => {
    let filePath: string | null = null

    try {
      const fixture = await openHardWrappedFixture(orcaPage, testInfo)
      filePath = fixture.filePath
      await placeCaretAtGoalParagraphEnd(orcaPage, fixture.sentinel)
      await orcaPage.keyboard.press('Enter')
      await orcaPage.keyboard.type('/')
      await orcaPage.keyboard.press('Backspace')
      await orcaPage.keyboard.press('Backspace')

      const metrics = await getGoalParagraphMetrics(orcaPage, fixture.sentinel)

      expect(metrics.hardBreakCount).toBe(0)
      expect(metrics.modelHardBreakCount).toBe(0)
      expect(metrics.paragraphCount).toBe(1)
      expect(metrics.sourceLineCount).toBe(4)
      expect(metrics.whiteSpace).toBe('normal')
      expect(metrics.lineCount).toBeLessThan(metrics.sourceLineCount)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('deleting the block boundary before a heading keeps hard-wrapped prose reflowing', async ({
    orcaPage
  }, testInfo) => {
    let filePath: string | null = null

    try {
      const fixture = await openHardWrappedFixture(orcaPage, testInfo)
      filePath = fixture.filePath
      await placeCaretAtHeadingStart(orcaPage, fixture.sentinel)
      await orcaPage.keyboard.press('Backspace')

      const metrics = await getGoalParagraphMetrics(orcaPage, fixture.sentinel)

      expect(metrics.hardBreakCount).toBe(0)
      expect(metrics.modelHardBreakCount).toBe(0)
      expect(metrics.paragraphCount).toBe(1)
      expect(metrics.sourceLineCount).toBe(4)
      expect(metrics.whiteSpace).toBe('normal')
      expect(metrics.lineCount).toBeLessThan(metrics.sourceLineCount)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
