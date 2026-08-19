import { useEffect, useRef, type RefObject } from 'react'
import type { editor } from 'monaco-editor'
import { diffViewStateCache } from '@/lib/scroll-cache'

type FirstDiffAutoScrollInput = {
  diffEditorRef: RefObject<editor.IStandaloneDiffEditor | null>
  modifiedEditor: editor.ICodeEditor | null
  modelKey: string
  pendingScrollCommentId: string | null
}

/**
 * Centers the first change once, per modelKey. Lives outside handleMount so it
 * runs after the comment decorator's view zones, which would otherwise shift
 * the content down after the scroll landed.
 */
export function useDiffViewerFirstDiffAutoScroll({
  diffEditorRef,
  modifiedEditor,
  modelKey,
  pendingScrollCommentId
}: FirstDiffAutoScrollInput): void {
  const didAutoScrollFirstDiffRef = useRef(false)
  const didAutoScrollModelKeyRef = useRef(modelKey)

  useEffect(() => {
    if (didAutoScrollModelKeyRef.current !== modelKey) {
      didAutoScrollModelKeyRef.current = modelKey
      // Why: reset the per-modelKey one-shot here before the first-diff guard runs for the new file.
      didAutoScrollFirstDiffRef.current = false
    }
    const diffEditor = diffEditorRef.current
    if (!diffEditor || !modifiedEditor) {
      return
    }
    if (didAutoScrollFirstDiffRef.current) {
      return
    }
    if (diffViewStateCache.get(modelKey)) {
      return
    }
    if (pendingScrollCommentId) {
      // Why: decorator owns this scroll, so set the one-shot flag; else we'd re-run and overwrite it when pendingScroll flips back to null.
      didAutoScrollFirstDiffRef.current = true
      return
    }
    let rafId: number | null = null
    const run = (): void => {
      if (didAutoScrollFirstDiffRef.current) {
        return
      }
      const changes = diffEditor.getLineChanges()
      if (!changes || changes.length === 0) {
        return
      }
      const line = Math.max(1, changes[0].modifiedStartLineNumber)
      // Defer one frame so view zones are laid out before measuring; cancel any earlier rAF to avoid a redundant scroll.
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (didAutoScrollFirstDiffRef.current || !modifiedEditor.getModel()) {
          return
        }
        const top = modifiedEditor.getTopForLineNumber(line, true)
        const editorHeight = modifiedEditor.getLayoutInfo().height
        modifiedEditor.setPosition({ lineNumber: line, column: 1 })
        modifiedEditor.setScrollTop(Math.max(0, top - editorHeight / 2))
        didAutoScrollFirstDiffRef.current = true
      })
    }
    // Run now if the diff is ready; otherwise onDidUpdateDiff fires once the computation lands.
    if (diffEditor.getLineChanges()) {
      run()
    }
    const sub = diffEditor.onDidUpdateDiff(() => run())
    return () => {
      sub.dispose()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [diffEditorRef, modifiedEditor, modelKey, pendingScrollCommentId])
}
