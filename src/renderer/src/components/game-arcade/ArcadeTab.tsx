import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  parseOrchestratorGameArcade,
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  ORCHESTRATOR_GAME_ARCADE_SNAKE,
  type OrchestratorGameArcade,
  type OrchestratorGameArcadeEngine
} from '../../../../shared/orchestrator-game-arcade-file'
import { paintArcadeFrame, type ArcadePaintSize } from './arcade-canvas-paint'
import {
  ARCADE_FRAME_MS,
  arcadeRunOf,
  inputArcadeRun,
  stepArcadeRun,
  type ArcadeInput,
  type ArcadeRun
} from './arcade-run-state'
import { arcadeCanvasLabel, arcadeWordsOf } from './arcade-words'
import { whoIsWaitingOnUser } from './arcade-hold'
import { keepArcadeRun, keptArcadeRunOf } from './arcade-kept-runs'

const builtInOf = (text: string): OrchestratorGameArcade => {
  const parsed = parseOrchestratorGameArcade(text)
  if (!parsed.ok) {
    throw new Error(`A built-in arcade game is invalid: ${parsed.error}`)
  }
  return parsed.game
}

const GAMES: Record<OrchestratorGameArcadeEngine, OrchestratorGameArcade> = {
  runner: builtInOf(ORCHESTRATOR_GAME_ARCADE_RUNNER),
  snake: builtInOf(ORCHESTRATOR_GAME_ARCADE_SNAKE)
}

type Props = {
  isActive: boolean
  /** The built-in game this play runs. */
  engine?: OrchestratorGameArcadeEngine
  /** The tab and play the run is kept under while the tab is hidden. */
  keepAs?: { tabId: string; play: number }
  /** Esc: back to the conversation, keeping the run. */
  onBack: () => void
  /** A press after the run ended: the tab closes and the conversation comes back. */
  onDone: () => void
}

/** One saved play of a built-in game, beside Claude in the center. */
export function ArcadeTab({
  isActive,
  engine = 'runner',
  keepAs,
  onBack,
  onDone
}: Props): React.JSX.Element {
  // Why a string: null runs, any string holds, and a primitive keeps the selector stable.
  const heldBy = useAppStore((s) => whoIsWaitingOnUser(s)?.name ?? null)
  const isHeld = heldBy !== null
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [firstRun] = useState(
    () =>
      (keepAs && keptArcadeRunOf(keepAs.tabId, keepAs.play)) ??
      arcadeRunOf(GAMES[engine], Date.now())
  )
  const runRef = useRef<ArcadeRun>(firstRun)
  const heldRef = useRef(isHeld)
  const heldByRef = useRef(heldBy ?? '')
  const paintRef = useRef<{ size: ArcadePaintSize; backdrop: HTMLCanvasElement } | null>(null)
  const frameRef = useRef<number | null>(null)

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const painted = paintRef.current
    const g = canvas?.getContext('2d')
    if (canvas && painted && g) {
      paintArcadeFrame(
        g,
        painted.backdrop,
        runRef.current,
        arcadeWordsOf(runRef.current.play.score, heldByRef.current, runRef.current.engine),
        painted.size
      )
    }
  }, [])

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  // Why only while running: a run that waits for a key, a reply or has ended costs no frames.
  const startLoop = useCallback(() => {
    if (frameRef.current !== null) {
      return
    }
    let last: number | null = null
    const tick = (now: number): void => {
      frameRef.current = null
      if (document.visibilityState !== 'visible') {
        return
      }
      if (last === null || now - last >= ARCADE_FRAME_MS) {
        const stepped = stepArcadeRun(
          runRef.current,
          last === null ? 0 : now - last,
          heldRef.current
        )
        last = now
        runRef.current = stepped.run
        if (stepped.changed) {
          paint()
        }
      }
      if (runRef.current.screen === 'running') {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [paint])

  const keepTabId = keepAs?.tabId
  const keepPlay = keepAs?.play
  useEffect(
    () => () => {
      if (keepTabId !== undefined && keepPlay !== undefined) {
        keepArcadeRun(keepTabId, keepPlay, runRef.current)
      }
    },
    [keepTabId, keepPlay]
  )

  /** Hands an input to the run; true when it was the game's, so the page should not act on it. */
  const send = useCallback(
    (input: ArcadeInput): boolean => {
      const box = boxRef.current
      const view = { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 }
      const sent = inputArcadeRun(runRef.current, input, view)
      if (sent.close) {
        onDone()
        return true
      }
      runRef.current = sent.run
      if (sent.isGame) {
        startLoop()
      }
      return sent.isGame
    },
    [onDone, startLoop]
  )

  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) {
      return
    }
    const observer = new ResizeObserver(() => {
      const width = box.clientWidth
      const height = box.clientHeight
      if (width === 0 || height === 0) {
        return
      }
      const size = { width, height, scale: window.devicePixelRatio || 1 }
      canvas.width = Math.round(width * size.scale)
      canvas.height = Math.round(height * size.scale)
      paintRef.current = { size, backdrop: runRef.current.play.backdropOf(size) }
      paint()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [paint])

  useEffect(() => {
    if (!isActive) {
      stopLoop()
      return
    }
    boxRef.current?.focus()
    startLoop()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        startLoop()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      stopLoop()
    }
  }, [isActive, startLoop, stopLoop])

  useEffect(() => {
    heldRef.current = isHeld
    heldByRef.current = heldBy ?? ''
    if (runRef.current.screen === 'held') {
      paint()
    }
    if (isActive && runRef.current.screen === 'held' && !isHeld) {
      startLoop()
    }
  }, [isActive, isHeld, heldBy, paint, startLoop])

  return (
    <div
      ref={boxRef}
      data-arcade-tab=""
      role="application"
      aria-label={arcadeCanvasLabel()}
      tabIndex={-1}
      className="relative h-full w-full bg-background outline-none"
      style={{ touchAction: 'none' }}
      data-arcade-engine={runRef.current.engine}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onBack()
        } else if (send({ kind: 'key', code: event.code, isDown: true })) {
          event.preventDefault()
        }
      }}
      onKeyUp={(event) => {
        if (send({ kind: 'key', code: event.code, isDown: false })) {
          event.preventDefault()
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        boxRef.current?.focus()
        const rect = event.currentTarget.getBoundingClientRect()
        send({
          kind: 'pointer',
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          isPress: true
        })
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        send({
          kind: 'pointer',
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          isPress: false
        })
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
    </div>
  )
}
