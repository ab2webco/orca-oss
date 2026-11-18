import { useEffect, useRef } from 'react'
import type React from 'react'
import { Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  DEFAULT_GAME_REWARD_WEIGHTS,
  GAME_REWARD_KINDS,
  type GameRewardKind
} from '../../../../shared/orchestrator-game-reward-weights'
import type { TeamXp } from '../../../../shared/team-xp-model'
import { isTeamLevelUp } from './team-xp-gain'
import { TEAM_XP_COUNT_MS, useTeamXpMotion, type TeamXpMotion } from './use-team-xp-motion'

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const GROW: Keyframe[] = [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }]
// Why a short rise: any higher and it crosses the project name above the row.
const RISE: Keyframe[] = [
  { opacity: 0, translate: '0 6px' },
  { opacity: 1, translate: '0 1px', offset: 0.2 },
  { opacity: 1, translate: '0 -1px', offset: 0.75 },
  { opacity: 0, translate: '0 -2px' }
]
// Why from below: the line under the bar rises into place, never over the bar row.
const NOTE_IN: Keyframe[] = [
  { opacity: 0, translate: '0 4px' },
  { opacity: 1, translate: '0 0' }
]
// Why a container query: the panel is ~215 px at a phone width, whatever the window says.
const WIDE_ONLY = '@max-[17rem]/xp:hidden'

const EARNS_TEXT: Record<GameRewardKind, () => string> = {
  'review-merged': () => translate('teamPanel.xp.earns.merged', 'A PR merged'),
  'perfect-merge': () => translate('teamPanel.xp.earns.perfectMerge', 'A perfect merge'),
  'ci-green': () => translate('teamPanel.xp.earns.ciGreen', 'CI turns green'),
  'work-item-review': () => translate('teamPanel.xp.earns.review', 'A ticket goes to review'),
  'work-item-done': () => translate('teamPanel.xp.earns.done', 'A ticket is done'),
  'member-claimed': () => translate('teamPanel.xp.earns.claimed', 'A member claims a ticket')
}

type Bar = { base: number; gain: { from: number; width: number } | null }

/** Ratios of the bar: the settled fill and the green gain beside it. */
function barOf(xp: TeamXp, motion: TeamXpMotion | null): Bar {
  const ratio = (into: number, need: number): number => (need > 0 ? Math.min(1, into / need) : 0)
  const settled = ratio(xp.into, xp.need)
  if (!motion || motion.still) {
    return { base: settled, gain: null }
  }
  const { from } = motion.gain
  if (motion.phase === 'fill' || motion.phase === 'sweep') {
    const start = ratio(from.into, from.need)
    return { base: start, gain: { from: start, width: 1 - start } }
  }
  if (motion.phase === 'landed') {
    return { base: 0, gain: { from: 0, width: settled } }
  }
  const start = ratio(Math.max(0, xp.into - motion.gain.gained), xp.need)
  return {
    base: motion.phase === 'settle' ? settled : start,
    gain: { from: start, width: settled - start }
  }
}

const gainText = (motion: TeamXpMotion): string =>
  motion.gain.reason
    ? translate('teamPanel.xp.gainWith', '+{{xp}} · {{reason}}', {
        xp: motion.gain.gained,
        reason: motion.gain.reason
      })
    : translate('teamPanel.xp.gain', '+{{xp}}', { xp: motion.gain.gained })

const levelUpText = (level: number): string =>
  translate('teamPanel.xp.levelUp', 'Level {{level}}!', { level })

/** The team's level and XP bar under the project name; it plays each gain the poll brings. */
export function TeamXpRow({ xp }: { xp: TeamXp }): React.JSX.Element {
  const { motion, left } = useTeamXpMotion(xp)
  const gainRef = useRef<HTMLSpanElement>(null)
  const sweepRef = useRef<HTMLSpanElement>(null)
  const chipRef = useRef<HTMLSpanElement>(null)
  const floatRef = useRef<HTMLSpanElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const levelUp = motion ? isTeamLevelUp(motion.gain) : false
  const old = motion?.phase === 'fill' || motion?.phase === 'sweep'
  const level = motion?.phase === 'fill' ? motion.gain.from.level : xp.level
  const nextLevel = (old && motion ? motion.gain.from.level : xp.level) + 1
  const bar = barOf(xp, motion)
  const floatAt = levelUp ? 50 : (bar.gain ? bar.gain.from + bar.gain.width : 1) * 100

  const phase = motion?.phase
  const motionKey = motion?.key
  // Why the key too: a gain that lands mid-play starts its own timeline at the same phase.
  useEffect(() => {
    const play = (
      el: HTMLElement | null,
      frames: Keyframe[],
      duration: number,
      easing = EASE_OUT
    ) => el?.animate?.(frames, { duration, easing, fill: 'forwards' })
    if (phase === 'grow' || phase === 'fill') {
      play(gainRef.current, GROW, phase === 'grow' ? TEAM_XP_COUNT_MS : 450)
      play(floatRef.current, RISE, 1800, 'ease-out')
      play(noteRef.current, NOTE_IN, 300)
    } else if (phase === 'settle') {
      play(gainRef.current, [{ opacity: 1 }, { opacity: 0 }], 500)
    } else if (phase === 'sweep') {
      play(sweepRef.current, [{ translate: '-100%' }, { translate: '100%' }], 700, 'ease-in-out')
      play(chipRef.current, [{ scale: 1 }, { scale: 1.14 }, { scale: 1 }], 450, 'ease-out')
    }
  }, [motionKey, phase])

  const up = levelUp && (phase === 'sweep' || phase === 'landed')
  // Why always when still: with no motion, these words are the whole notice.
  const note =
    motion && (motion.still || levelUp || motion.gain.reason)
      ? `${motion.still && levelUp ? `${levelUpText(xp.level)} ` : ''}${gainText(motion)}`
      : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div data-team-xp="" tabIndex={0} className="@container/xp px-3 pb-1.5 outline-none">
          <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground @max-[17rem]/xp:gap-1.5">
            <span
              ref={chipRef}
              data-team-xp-level={level}
              className={cn(
                '-ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-1.5 font-medium whitespace-nowrap text-foreground transition-colors duration-300',
                up &&
                  'border-status-success-border bg-status-success-background font-semibold text-status-success'
              )}
            >
              {up ? <Sparkles className="size-3" aria-hidden /> : null}
              {translate('teamPanel.xp.level', 'Lv {{level}}', { level })}
            </span>
            <span className="relative h-1.5 min-w-24 flex-1 rounded-full bg-muted">
              <span className="absolute inset-0 overflow-hidden rounded-full">
                <span
                  className="absolute inset-y-0 left-0 bg-foreground/60"
                  style={{ width: `${bar.base * 100}%` }}
                />
                {bar.gain ? (
                  <span
                    key={`${motion?.key}-${old ? 'old' : 'new'}`}
                    ref={gainRef}
                    data-team-xp-gain=""
                    className="absolute inset-y-0 origin-left bg-status-success"
                    style={{ left: `${bar.gain.from * 100}%`, width: `${bar.gain.width * 100}%` }}
                  />
                ) : null}
                {phase === 'sweep' ? (
                  <span
                    ref={sweepRef}
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-status-success to-transparent"
                  />
                ) : null}
              </span>
              {motion && !motion.still && (levelUp || phase === 'grow' || phase === 'settle') ? (
                <span
                  key={motion.key}
                  ref={floatRef}
                  data-team-xp-float=""
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute bottom-full pb-0.5 leading-none font-semibold whitespace-nowrap text-status-success opacity-0',
                    // Why: a phone-width row has no room above its bar; the line under it speaks.
                    WIDE_ONLY
                  )}
                  style={{ left: `${floatAt}%`, transform: `translateX(-${floatAt}%)` }}
                >
                  {levelUp ? levelUpText(xp.level) : gainText(motion)}
                </span>
              ) : null}
            </span>
            <span data-team-xp-left="" className="shrink-0 whitespace-nowrap">
              {translate('teamPanel.xp.left', '{{left}} XP', { left })}
              <span className={WIDE_ONLY}>
                {' '}
                {translate('teamPanel.xp.toLevel', 'to Lv {{level}}', { level: nextLevel })}
              </span>
            </span>
          </div>
          {note ? (
            <div
              ref={noteRef}
              data-team-xp-note=""
              role="status"
              className={cn(
                'pt-0.5 text-xs font-semibold text-status-success',
                // Why: a plain gain names its reason above the bar where there is room for it.
                !motion?.still && !levelUp && '@min-[17rem]/xp:hidden'
              )}
            >
              {motion && !motion.still && levelUp ? (
                <span className="@min-[17rem]/xp:hidden">{levelUpText(xp.level)} </span>
              ) : null}
              {note}
            </div>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        collisionPadding={16}
        className="max-w-[min(18rem,calc(100vw-2rem))] text-left"
      >
        <p className="font-medium">
          {translate('teamPanel.xp.title', 'Team XP: {{into}}/{{need}} to Lv {{level}}', {
            into: xp.into,
            need: xp.need,
            level: xp.level + 1
          })}
        </p>
        <p className="mt-1 opacity-70">{translate('teamPanel.xp.earnsTitle', 'What earns XP')}</p>
        <ul className="tabular-nums">
          {GAME_REWARD_KINDS.map((kind) => (
            <li key={kind} className="flex justify-between gap-3">
              <span>{EARNS_TEXT[kind]()}</span>
              <span>+{(xp.earns ?? DEFAULT_GAME_REWARD_WEIGHTS)[kind]}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
