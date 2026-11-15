import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
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
import type { LeadPromptOutcome } from '../../../src/shared/team-lead-prompt-sender'
import { teamDockActionsOf, type TeamAction } from '../../../src/shared/team-panel-actions'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamActionHintOf, teamActionLabelOf, type TeamControlWords } from './team-control-words'
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
const NOTE_MS = 4_000

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
  onSend: (action: TeamAction) => Promise<LeadPromptOutcome>
}) {
  const { width } = useWindowDimensions()
  const [confirming, setConfirming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) {
      return
    }
    const timer = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])
  const chips = teamDockActionsOf(control.actions, null)
  const stop = control.actions.find((one) => one.orca === 'stop') ?? null
  if (control.actions.length === 0) {
    return null
  }
  const run = (action: TeamAction): void => {
    setConfirming(false)
    const label = teamActionLabelOf(action, words)
    void onSend(action).then((outcome) => {
      if (outcome !== 'repeat') {
        setNote(outcome === 'sent' ? words.sent(label) : words.failed(label))
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
      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite" numberOfLines={1}>
          {note}
        </Text>
      ) : null}
      <View style={styles.dock}>
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
        <View style={styles.spacer} />
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
  spacer: {
    flex: 1
  },
  icon: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center'
  },
  note: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
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
