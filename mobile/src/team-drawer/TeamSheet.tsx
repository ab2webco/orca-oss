import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import {
  formatLeadTime,
  teamPeekOf,
  type TeamDrawerData,
  type TeamMemberRow,
  type TeamMetrics
} from './team-drawer-model'
import { TeamMemberCard } from './TeamMemberCard'
import { TeamAdvisorCardView, TeamLeadCardView } from './TeamLeadCards'
import { teamSceneLeadLineOf } from './team-sheet-lead'
import { teamCardWordsOf, type TeamCardWords } from './team-card-words'
import { TeamInboxTab } from './TeamInboxTab'
import { teamInboxWordsOf } from './team-inbox-words'
import { useTeamSheetDrag } from './use-team-sheet-drag'
import { PeekBar, TEAM_PEEK_HEIGHT } from './TeamPeekBar'
import { TeamSheetTabBar, type TeamTab } from './TeamSheetTabBar'
import { TeamHostsTab } from './TeamHostsTab'
import { TeamPrsTab } from './TeamPrsTab'
import { teamWorkWordsOf } from './team-work-words'
import { TeamLevelRow } from './TeamLevelRow'
import { TeamSceneBand } from './TeamSceneBand'
import { useTeamSceneBandShown } from './use-team-scene-band-shown'
import { TeamActionDock, TeamStoppedBanner } from './TeamActionDock'
import { teamControlWordsOf } from './team-control-words'
import { TeamTonesProvider } from './team-status-tone'

export { TEAM_PEEK_HEIGHT }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: TeamDrawerData
  now: number
  /** The paired desktop's name; null until the host record loads. */
  hostName: string | null
  onOpenLink: (url: string) => void
  onOpenTerminal: (terminal: NonNullable<TeamMemberRow['terminal']>) => void
}

function MetricsSummary({ metrics, words }: { metrics: TeamMetrics; words: TeamCardWords }) {
  const tiles = [
    metrics.latestDay
      ? { label: words.mergedOn(metrics.latestDay.day), value: metrics.latestDay.merged }
      : null,
    { label: words.mergedIn(metrics.windowDays), value: metrics.mergedInWindow },
    metrics.leadTimeMedianMs === null
      ? null
      : { label: words.medianLeadTime, value: formatLeadTime(metrics.leadTimeMedianMs) }
  ].filter((one) => one !== null)
  return (
    <View style={styles.metrics}>
      {tiles.map((tile) => (
        <View key={tile.label} style={styles.metricRow}>
          <Text style={styles.metricLabel} numberOfLines={1}>
            {tile.label}
          </Text>
          <Text style={styles.metricValue}>{String(tile.value)}</Text>
        </View>
      ))}
    </View>
  )
}

/** The lead's Team as a bottom sheet over its terminal: a 60 pt peek that drags or taps open to 84%. */
export function TeamSheet({
  open,
  onOpenChange,
  team,
  now,
  hostName,
  onOpenLink,
  onOpenTerminal
}: Props) {
  const { view, questions } = team
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  // Why null until picked: each open lands on the Inbox while a question waits, else on the Team.
  const [picked, setPicked] = useState<TeamTab | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const sheetHeight = Math.round(height * 0.84)
  // Why measured: the column can be shorter than 84% of the window (keyboard, header), which caps it.
  const [laidOut, setLaidOut] = useState(sheetHeight)
  const setOpen = (next: boolean): void => {
    if (!next) {
      setPicked(null)
    }
    onOpenChange(next)
  }
  const drag = useTeamSheetDrag(
    open,
    Math.max(0, Math.min(laidOut, sheetHeight) - TEAM_PEEK_HEIGHT - insets.bottom),
    setOpen
  )
  const tab: TeamTab = picked ?? (questions.length > 0 ? 'inbox' : 'team')
  const { scrollY } = drag
  const sceneBand = useTeamSceneBandShown(scrollY)
  const scrollRef = useRef<Animated.ScrollView>(null)
  // Why scroll, not a key: a keyed ScrollView remounted the stage's WebView on every switch (ORCA-1307).
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    scrollY.value = 0
  }, [tab, scrollY])
  useEffect(() => {
    if (!open) {
      return
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(null)
      onOpenChange(false)
      return true
    })
    return () => sub.remove()
  }, [open, onOpenChange])
  if (!view) {
    return null
  }
  const words = teamCardWordsOf(view.locale)
  const workWords = teamWorkWordsOf(view.locale)
  const controlWords = teamControlWordsOf(view.locale)
  const peek = teamPeekOf(
    view,
    questions.length,
    questions.flatMap((one) => (one.ticket ? [one.ticket.toUpperCase()] : [])),
    words
  )
  const close = (): void => setOpen(false)
  return (
    <TeamTonesProvider value={team.tones}>
      {/* Why: holds the peek's place in the column so the command dock stays above it. */}
      <View style={{ height: TEAM_PEEK_HEIGHT + insets.bottom }} />
      {open ? (
        // Why no scrim: the lead's terminal stays readable above the sheet, as in V30.
        <Pressable
          testID="team-sheet-above"
          style={[StyleSheet.absoluteFill, styles.layer]}
          onPress={close}
          accessible={false}
        />
      ) : null}
      <Animated.View
        style={[styles.sheet, { height: sheetHeight }, drag.sheetStyle]}
        onLayout={(event) => setLaidOut(Math.round(event.nativeEvent.layout.height))}
        accessibilityViewIsModal={open}
      >
        {/* Why: the rounded corners showed the terminal row behind them as a stray glyph in the drag area. */}
        <View testID="team-sheet-corners" style={styles.corners} />
        {/* Why inside the sheet: a root over the column would swallow the terminal's touches on Android. */}
        <GestureHandlerRootView style={[styles.dock, styles.body, styles.clip]}>
          <GestureDetector gesture={drag.handlePan}>
            <View collapsable={false}>
              <PeekBar peek={peek} open={open} words={words} onPress={() => setOpen(!open)} />
            </View>
          </GestureDetector>
          {drag.resting ? null : (
            <GestureDetector gesture={drag.contentPan}>
              <View style={styles.body} collapsable={false}>
                <GestureDetector gesture={drag.scrollGesture}>
                  <Animated.ScrollView
                    ref={scrollRef}
                    bounces={false}
                    onScroll={drag.scrollHandler}
                    scrollEventThrottle={16}
                    contentContainerStyle={[
                      styles.content,
                      { paddingBottom: insets.bottom + spacing.lg }
                    ]}
                  >
                    {view.control.stopped ? (
                      <TeamStoppedBanner stopped={view.control.stopped} words={controlWords} />
                    ) : null}
                    {view.scene ? (
                      <TeamSceneBand
                        band={view.scene}
                        ownArt={team.sceneArt}
                        leadLine={view.lead ? teamSceneLeadLineOf(view.lead, words) : null}
                        leadName={view.lead?.name ?? null}
                        advisorName={words.advisorName}
                        members={view.members}
                        shown={sceneBand.shown}
                        cameraLabels={{ lead: words.followLead, all: words.showAll }}
                        sheetGestures={[drag.scrollGesture, drag.contentPan]}
                        onLayout={sceneBand.onLayout}
                      />
                    ) : null}
                    {team.level ? <TeamLevelRow level={team.level} words={words} /> : null}
                    <TeamSheetTabBar
                      active={tab}
                      inboxCount={questions.length}
                      work={view.work}
                      words={words}
                      workWords={workWords}
                      onSelect={setPicked}
                    />
                    {tab === 'prs' ? (
                      <TeamPrsTab work={view.work} words={workWords} onOpenLink={onOpenLink} />
                    ) : tab === 'hosts' ? (
                      <TeamHostsTab
                        machines={view.work.machines}
                        members={view.members}
                        hostName={hostName}
                        locale={view.locale}
                        words={workWords}
                      />
                    ) : tab === 'inbox' ? (
                      <TeamInboxTab
                        team={team}
                        now={now}
                        words={teamInboxWordsOf(view.locale)}
                        onOpenLink={onOpenLink}
                      />
                    ) : (
                      <>
                        <View style={styles.section}>
                          <Text style={styles.sectionTitle}>
                            {words.members(view.members.length)}
                          </Text>
                          {view.members.length > 0 ? (
                            view.members.map((member) => (
                              <TeamMemberCard
                                key={member.key}
                                member={member}
                                hostName={hostName}
                                now={now}
                                words={words}
                                expanded={expanded === member.key}
                                onToggle={() =>
                                  setExpanded(expanded === member.key ? null : member.key)
                                }
                                onAnswer={() => setPicked('inbox')}
                                onOpenLink={onOpenLink}
                                onOpenTerminal={(terminal) => {
                                  close()
                                  onOpenTerminal(terminal)
                                }}
                              />
                            ))
                          ) : (
                            <Text style={styles.empty}>{words.noMembersRunning}</Text>
                          )}
                          {view.lead ? (
                            <TeamLeadCardView
                              lead={view.lead}
                              memberCount={view.members.length}
                              hostName={hostName}
                              words={words}
                            />
                          ) : null}
                          {view.advisor ? (
                            <TeamAdvisorCardView advisor={view.advisor} words={words} />
                          ) : null}
                        </View>
                        {view.metrics ? (
                          <View style={styles.section}>
                            <Text style={styles.sectionTitle}>{words.metrics}</Text>
                            <MetricsSummary metrics={view.metrics} words={words} />
                          </View>
                        ) : null}
                      </>
                    )}
                  </Animated.ScrollView>
                </GestureDetector>
              </View>
            </GestureDetector>
          )}
          {!drag.resting && team.sendAction ? (
            <View style={{ paddingBottom: insets.bottom }}>
              <TeamActionDock
                control={view.control}
                memberCount={view.members.length}
                words={controlWords}
                onSend={team.sendAction}
              />
            </View>
          ) : null}
        </GestureHandlerRootView>
      </Animated.View>
    </TeamTonesProvider>
  )
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: colors.bgPanel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card
  },
  // Why zIndex: the command dock sits at 20 and must not draw over the open sheet.
  layer: {
    zIndex: 30
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    maxHeight: '100%'
  },
  clip: {
    overflow: 'hidden'
  },
  corners: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: radii.card,
    backgroundColor: colors.terminalBg
  },
  body: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.lg
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.bodySize
  },
  // Why rows: side-by-side tiles at 320 pt split the date label and orphaned the third tile.
  metrics: {
    flexDirection: 'column',
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.md
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  metricLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  }
})
