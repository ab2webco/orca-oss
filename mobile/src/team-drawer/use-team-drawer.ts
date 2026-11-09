import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import type { OwnerQuestionReply } from '../game-inbox/game-owner-questions-rpc'
import { useGameOwnerQuestions } from '../game-inbox/use-game-owner-questions'
import {
  leadOwnerQuestionsOf,
  teamLeadViewOf,
  type TeamDrawerData,
  type TeamInbox
} from './team-drawer-model'
import { readLeadGameState, readLeadInboxThreads } from './team-drawer-rpc'

// Why 20 s: game.state reads reviews and metrics; the desktop Panel already polls the same cache.
const TEAM_REFRESH_MS = 20_000

export function useTeamDrawer(args: {
  client: RpcClient | null
  connected: boolean
  worktreeId: string
  terminalHandle: string | null
  paneKey: string | null
}): TeamDrawerData {
  const { client, connected, worktreeId, terminalHandle, paneKey } = args
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )
  const candidate = connected && focused && !!client && !!terminalHandle && !!paneKey
  const inbox = useGameOwnerQuestions(client, connected, candidate)
  const reloadQuestions = inbox.reload
  const terminalKey = `${worktreeId}|${terminalHandle}|${paneKey}`
  // Why keyed: another tab may not be the lead; never show the last tab's Team over it.
  const [read, setRead] = useState<{ key: string; state: unknown } | null>(null)
  const rawState = read?.key === terminalKey ? read.state : null
  const [inboxRead, setInboxRead] = useState<{ key: string; inbox: TeamInbox } | null>(null)
  const leadInbox: TeamInbox =
    inboxRead?.key === terminalKey ? inboxRead.inbox : { kind: 'loading' }
  const generationRef = useRef(0)

  useEffect(() => {
    if (!candidate || !client || !terminalHandle || !paneKey) {
      return
    }
    const generation = ++generationRef.current
    const refresh = (): void => {
      if (AppState.currentState !== 'active') {
        return
      }
      void readLeadGameState(client, { worktreeId, terminalHandle, paneKey })
        .then(async (result) => {
          if (generationRef.current !== generation) {
            return
          }
          const state = result.status === 'ok' ? result.state : null
          setRead({ key: terminalKey, state })
          // Why after the state: only a live lead has an Inbox, so other panes cost no read.
          if (!teamLeadViewOf(state)) {
            return
          }
          const threads = await readLeadInboxThreads(client, { worktreeId, terminalHandle })
          if (generationRef.current === generation) {
            const inbox: TeamInbox =
              threads.status === 'ok'
                ? { kind: 'ready', threads: threads.threads }
                : { kind: 'unavailable' }
            setInboxRead({ key: terminalKey, inbox })
          }
        })
        // Why keep the last state: a failed read says nothing about the team.
        .catch(() => {})
    }
    refresh()
    const interval = setInterval(() => {
      refresh()
      void reloadQuestions()
    }, TEAM_REFRESH_MS)
    return () => {
      generationRef.current++
      clearInterval(interval)
    }
  }, [candidate, client, paneKey, reloadQuestions, terminalHandle, terminalKey, worktreeId])

  const own = useMemo(
    () =>
      inbox.state.kind === 'ready'
        ? leadOwnerQuestionsOf(inbox.state.projects, worktreeId)
        : { worktreeId: null, questions: [] },
    [inbox.state, worktreeId]
  )
  const view = useMemo(() => {
    const tickets = new Set(
      own.questions.flatMap((one) => (one.ticket ? [one.ticket.toUpperCase()] : []))
    )
    return teamLeadViewOf(rawState, tickets)
  }, [own.questions, rawState])

  const inboxAnswer = inbox.answer
  const answer = useCallback(
    async (id: string, reply: OwnerQuestionReply): Promise<void> => {
      if (!own.worktreeId) {
        throw new Error('This host has no worktree to answer through.')
      }
      await inboxAnswer(own.worktreeId, id, reply)
    },
    [inboxAnswer, own.worktreeId]
  )

  return {
    view,
    questions: view ? own.questions : [],
    answerWorktreeId: own.worktreeId,
    inbox: leadInbox,
    answer
  }
}
