import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import {
  answerGameOwnerQuestion,
  readOpenGameOwnerQuestions,
  type GameInboxScope
} from './game-owner-questions-client'
import { onGameOwnerQuestionsChanged } from './game-owner-questions-signal'

const NO_QUESTIONS: GameOwnerQuestion[] = []

function scopeKeyOf(scope: GameInboxScope | null): string | null {
  if (!scope) {
    return null
  }
  const host = scope.target.kind === 'local' ? 'local' : scope.target.environmentId
  return `${host}\u0000${scope.worktreeId}`
}

/** The open questions the lead asked the person, reread on a pushed change or window focus. */
export function useGameOwnerQuestions(scope: GameInboxScope | null): {
  questions: GameOwnerQuestion[]
  answer: (id: string, reply: GameOwnerReply) => Promise<void>
} {
  const [loaded, setLoaded] = useState<{ key: string; questions: GameOwnerQuestion[] } | null>(null)
  const scopeKey = scopeKeyOf(scope)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  // Why: a slower earlier read must not overwrite a later one.
  const readSeq = useRef(0)

  const reload = useCallback(async () => {
    const current = scopeRef.current
    const key = scopeKeyOf(current)
    if (!current || !key) {
      return
    }
    const seq = ++readSeq.current
    try {
      const questions = await readOpenGameOwnerQuestions(current)
      if (seq === readSeq.current) {
        setLoaded({ key, questions })
      }
    } catch {
      // Why: a host without the board (older build, offline) shows no questions, not an error.
      if (seq === readSeq.current) {
        setLoaded({ key, questions: NO_QUESTIONS })
      }
    }
  }, [])

  useEffect(() => {
    if (!scopeKey) {
      return
    }
    void reload()
    const reloadNow = (): void => void reload()
    const stopLocal = window.api.runtime.onGameOwnerQuestionsChanged?.(reloadNow)
    const stopPaired = onGameOwnerQuestionsChanged(reloadNow)
    window.addEventListener('focus', reloadNow)
    return () => {
      stopLocal?.()
      stopPaired()
      window.removeEventListener('focus', reloadNow)
    }
  }, [scopeKey, reload])

  const answer = useCallback(
    async (id: string, reply: GameOwnerReply) => {
      const current = scopeRef.current
      if (!current) {
        return
      }
      await answerGameOwnerQuestion(current, id, reply)
      await reload()
    },
    [reload]
  )

  return {
    questions: loaded && loaded.key === scopeKey ? loaded.questions : NO_QUESTIONS,
    answer
  }
}
