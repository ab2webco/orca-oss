import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import {
  Activity,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  FlaskConical,
  GitPullRequest,
  List,
  MoreHorizontal,
  Play,
  Search,
  Square,
  Tag
} from 'lucide-react-native'
import type { GameActionIcon } from '../../../src/shared/orchestrator-game-actions'
import { teamDockActionsOf, type TeamAction } from '../../../src/shared/team-panel-actions'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamActionHintOf, teamActionLabelOf, type TeamControlWords } from './team-control-words'
import type { TeamTurnResult } from './team-lead-turn-send'
import type { TeamSheetControl } from './team-sheet-control'
import { TeamActionMenu } from './TeamActionMenu'
import { useTeamTones } from './team-status-tone'

// Why these glyphs: the desktop dock's (team-action-icons.tsx), so both surfaces read the same.
const ICONS: Record<GameActionIcon, typeof Square> = {
  ship: ArrowUpFromLine,
  flask: FlaskConical,
  tag: Tag,
  review: GitPullRequest,
  scan: Search,
  list: List,
  pulse: Activity,
  launch: ArrowRight,
  play: Play,
  check: Check,
  stop: Square
}
// Why: below this width three labelled chips and Stop do not fit; icon and count say it (p05 at 320).
const LABELS_FROM_WIDTH = 360
// Why 8 s: a 4 s line under the thumb went unread, and the owner thought the Wave never fired.
const NOTE_MS = 8_000
const FADE_STEPS = [0.15, 0.35, 0.55, 0.75, 0.9, 1]

/** Whether chips still run past the strip's right edge, so the fade must say it scrolls. */
export function teamDockStripOverflows(contentWidth: number, viewWidth: number, scrollX: number) {
  return contentWidth - viewWidth - scrollX > 1
}

// Why a strip: wrapped chips pushed Stop and the menu onto a second 52 pt row over the tab (ORCA-1310).
function ChipStrip({ children }: { children: ReactNode }) {
  const [viewWidth, setViewWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  return (
    <View
      testID="team-dock-strip"
      style={styles.strip}
      onLayout={(event) => setViewWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        onContentSizeChange={(width) => setContentWidth(width)}
        onScroll={(event) => setScrollX(event.nativeEvent.contentOffset.x)}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      {teamDockStripOverflows(contentWidth, viewWidth, scrollX) ? (
        <View testID="team-dock-fade" pointerEvents="none" style={styles.fade}>
          {FADE_STEPS.map((opacity) => (
            <View key={opacity} style={[styles.fadeStep, { opacity }]} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** A STOP's line above the tabs: who stopped it, and that members still run with pushes paused. */
export function TeamStoppedBanner({
  stopped,
  words
}: {
  stopped: NonNullable<TeamSheetControl['stopped']>
  words: TeamControlWords
}) {
  const tones = useTeamTones()
  return (
    <View style={styles.banner}>
      <View style={[styles.dot, { backgroundColor: tones.attention }]} />
      {/* Why one paragraph: at 320 the paused part must wrap under the title, not be cut. */}
      <Text style={styles.bannerText}>
        <Text style={styles.bannerTitle}>
          {stopped.by ? words.stoppedBy(stopped.by) : words.stopped}
        </Text>
        {stopped.membersRunning > 0 ? ` ${words.paused}` : null}
      </Text>
    </View>
  )
}

/** The lead's actions under the sheet; every one is a turn sent to the lead (p05). */
export function TeamActionDock({
  control,
  memberCount,
  words,
  onSend
}: {
  control: TeamSheetControl
  memberCount: number
  words: TeamControlWords
  onSend: (action: TeamAction) => Promise<TeamTurnResult>
}) {
  const { width } = useWindowDimensions()
  const [confirming, setConfirming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: 'info' | 'attention' } | null>(null)
  // The team's size when a Wave went out, so its launches can be counted as they join.
  const [waveFrom, setWaveFrom] = useState<number | null>(null)
  const tones = useTeamTones()
  useEffect(() => {
    if (!note) {
      return
    }
    const timer = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])
  // Why derived: the count must show on the render the members join, not one render later.
  const launched = waveFrom !== null && memberCount > waveFrom ? memberCount - waveFrom : 0
  useEffect(() => {
    if (launched === 0) {
      return
    }
    const timer = setTimeout(() => setWaveFrom(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [launched])
  const shown = launched > 0 ? { text: words.launched(launched), tone: 'info' as const } : note
  const chips = teamDockActionsOf(control.actions, null)
  const stop = control.actions.find((one) => one.orca === 'stop') ?? null
  if (control.actions.length === 0) {
    return null
  }
  const run = (action: TeamAction): void => {
    setConfirming(false)
    setWaveFrom(null)
    const label = teamActionLabelOf(action, words)
    setNote({ text: words.sending(label), tone: 'info' })
    void onSend(action).then(({ outcome, reason }) => {
      if (outcome === 'sent') {
        setNote({ text: words.sent(label), tone: 'info' })
        setWaveFrom(action.orca === 'wave' ? memberCount : null)
      } else if (outcome === 'failed') {
        const text = reason ? `${words.failed(label)}: ${reason}` : words.failed(label)
        setNote({ text, tone: 'attention' })
      }
    })
  }
  if (confirming && stop) {
    return (
      <View style={styles.dock}>
        <Text style={styles.confirm}>{words.stopConfirm(memberCount)}</Text>
        <Pressable
          style={[styles.button, styles.danger]}
          onPress={() => run(stop)}
          accessibilityRole="button"
          accessibilityLabel={teamActionLabelOf(stop, words)}
        >
          <Text style={styles.dangerText}>{teamActionLabelOf(stop, words)}</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => setConfirming(false)}
          accessibilityRole="button"
          accessibilityLabel={words.cancel}
        >
          <Text style={styles.chipText}>{words.cancel}</Text>
        </Pressable>
      </View>
    )
  }
  if (menuOpen) {
    return (
      <View style={styles.column}>
        <TeamActionMenu
          actions={control.actions}
          words={words}
          onPick={(action) => {
            setMenuOpen(false)
            if (action.orca === 'stop') {
              setConfirming(true)
            } else {
              run(action)
            }
          }}
          onClose={() => setMenuOpen(false)}
        />
      </View>
    )
  }
  const labelled = width >= LABELS_FROM_WIDTH
  return (
    <View style={styles.column} accessibilityLabel={words.actions}>
      {shown ? (
        <View style={styles.noteLine}>
          <View style={[styles.dot, { backgroundColor: tones[shown.tone] }]} />
          <Text style={styles.note} accessibilityLiveRegion="polite" numberOfLines={2}>
            {shown.text}
          </Text>
        </View>
      ) : null}
      <View testID="team-dock-row" style={styles.row}>
        <ChipStrip>
          {chips.map((action) => {
            const Icon = ICONS[action.icon ?? 'pulse']
            const label = teamActionLabelOf(action, words)
            return (
              <Pressable
                key={action.id}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={() => run(action)}
                disabled={action.off !== null}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${teamActionHintOf(action, words)}`}
                accessibilityHint={action.off ? words.off[action.off] : undefined}
              >
                <Icon size={14} color={colors.textSecondary} />
                {labelled ? <Text style={styles.chipText}>{label}</Text> : null}
                {action.now ? <Text style={styles.count}>{String(action.now.count)}</Text> : null}
              </Pressable>
            )
          })}
        </ChipStrip>
        {stop ? (
          <Pressable
            style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
            onPress={() => setConfirming(true)}
            disabled={stop.off !== null}
            accessibilityRole="button"
            accessibilityLabel={words.stopAll}
            accessibilityHint={stop.off ? words.off[stop.off] : undefined}
          >
            <Square size={16} color={stop.off ? colors.textMuted : colors.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={words.menu.label}
        >
          <MoreHorizontal size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  pressed: {
    opacity: 0.7
  },
  chipText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  count: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  strip: {
    flex: 1,
    minWidth: 0
  },
  chips: {
    gap: spacing.sm
  },
  fade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: spacing.xl,
    flexDirection: 'row'
  },
  fadeStep: {
    flex: 1,
    backgroundColor: colors.bgPanel
  },
  icon: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center'
  },
  noteLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  note: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.metaSize + 1
  },
  confirm: {
    flex: 1,
    minWidth: 140,
    color: colors.textPrimary,
    fontSize: typography.metaSize + 1
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.button
  },
  danger: {
    backgroundColor: colors.statusRed
  },
  dangerText: {
    color: colors.onAccent,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgBase
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  bannerTitle: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  bannerText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1
  }
})
