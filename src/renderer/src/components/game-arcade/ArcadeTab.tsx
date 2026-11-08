import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  parseOrchestratorGameArcade,
  ORCHESTRATOR_GAME_ARCADE_RUNNER
} from '../../../../shared/orchestrator-game-arcade-file'
import { arcadeBackdropOf, paintArcadeFrame, type ArcadePaintSize } from './arcade-canvas-paint'
import {
  ARCADE_FRAME_MS,
  arcadeRunOf,
  pressArcadeRun,
  stepArcadeRun,
  type ArcadeRun
} from './arcade-run-state'
import { arcadeCanvasLabel, arcadeWordsOf } from './arcade-words'
import { isSomeoneWaitingOnUser } from './arcade-hold'

const GAME = (() => {
  const parsed = parseOrchestratorGameArcade(ORCHESTRATOR_GAME_ARCADE_RUNNER)
  if (!parsed.ok) {
    throw new Error(`The built-in runner is invalid: ${parsed.error}`)
  }
  return parsed.game
})()

const JUMP_KEYS = new Set(['Space', 'ArrowUp'])

type Props = {
  isActive: boolean
  /** Esc: back to the conversation, keeping the run. */
  onBack: () => void
  /** A press after the run ended: the tab closes and the conversation comes back. */
  onDone: () => void
}

/** One saved play of the runner, beside Claude in the center. */
export function ArcadeTab({ isActive, onBack, onDone }: Props): React.JSX.Element {
  const isHeld = useAppStore((s) => isSomeoneWaitingOnUser(s.agentStatusByPaneKey))
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [firstRun] = useState(() => arcadeRunOf(GAME, Date.now()))
  const runRef = useRef<ArcadeRun>(firstRun)
  const heldRef = useRef(isHeld)
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
        arcadeWordsOf(Math.floor(runRef.current.state.score)),
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

  const press = useCallback(() => {
    const pressed = pressArcadeRun(runRef.current)
    if (pressed.close) {
      onDone()
      return
    }
    runRef.current = pressed.run
    startLoop()
  }, [onDone, startLoop])

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
      paintRef.current = { size, backdrop: arcadeBackdropOf(size) }
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
    if (isActive && runRef.current.screen === 'held' && !isHeld) {
      startLoop()
    }
  }, [isActive, isHeld, startLoop])

  return (
    <div
      ref={boxRef}
      data-arcade-tab=""
      role="application"
      aria-label={arcadeCanvasLabel()}
      tabIndex={-1}
      className="relative h-full w-full bg-background outline-none"
      style={{ touchAction: 'manipulation' }}
      onKeyDown={(event) => {
        if (JUMP_KEYS.has(event.code)) {
          event.preventDefault()
          press()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onBack()
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        boxRef.current?.focus()
        press()
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
    </div>
  )
}
