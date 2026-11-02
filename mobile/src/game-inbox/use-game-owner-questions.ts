import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameOwnerQuestionProject } from '../../../src/shared/orchestrator-game-owner-questions'
import type { RpcClient } from '../transport/rpc-client'
import {
  answerHostOwnerQuestion,
  readHostOwnerQuestions,
  type OwnerQuestionReply
} from './game-owner-questions-rpc'

export type GameOwnerQuestionsState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; projects: GameOwnerQuestionProject[] }

export type GameOwnerQuestionsInbox = {
  state: GameOwnerQuestionsState
  refreshing: boolean
  /** A refresh that failed while a list was already shown; the list stays. */
  refreshError: string | null
  reload: () => Promise<void>
  /** Throws the host's refusal so the card can show it next to the question. */
  answer: (worktreeId: string, id: string, reply: OwnerQuestionReply) => Promise<void>
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Reads on connect and each time `active` turns true (the screen regaining focus). */
export function useGameOwnerQuestions(
  client: RpcClient | null,
  connected: boolean,
  active = true
): GameOwnerQuestionsInbox {
  const [state, setState] = useState<GameOwnerQuestionsState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    if (!client || !connected) {
      return
    }
    const generation = generationRef.current + 1
    generationRef.current = generation
    setRefreshing(true)
    try {
      const read = await readHostOwnerQuestions(client)
      if (generationRef.current !== generation) {
        return
      }
      setState(
        read.status === 'ok' ? { kind: 'ready', projects: read.projects } : { kind: 'unavailable' }
      )
      setRefreshError(null)
    } catch (error) {
      if (generationRef.current !== generation) {
        return
      }
      // Why: a failed refresh must not blank questions the person can still answer; the banner shows only over them.
      const message = errorText(error)
      setRefreshError(message)
      setState((current) => (current.kind === 'ready' ? current : { kind: 'error', message }))
    } finally {
      if (generationRef.current === generation) {
        setRefreshing(false)
      }
    }
  }, [client, connected])

  useEffect(() => {
    if (active) {
      void reload()
    }
  }, [active, reload])

  const answer = useCallback(
    async (worktreeId: string, id: string, reply: OwnerQuestionReply): Promise<void> => {
      if (!client) {
        throw new Error('Not connected to this host.')
      }
      await answerHostOwnerQuestion(client, { worktreeId, id, reply })
      await reload()
    },
    [client, reload]
  )

  return { state, refreshing, refreshError, reload, answer }
}
