import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View
} from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import type { OwnerQuestionReply } from './game-owner-questions-rpc'
import { GameInboxQuestionCard } from './GameInboxQuestionCard'
import type { GameOwnerQuestionsState } from './use-game-owner-questions'

export type GameInboxListProps = {
  /** True until the host connects, when there is nothing read yet to show. */
  connecting: boolean
  state: GameOwnerQuestionsState
  refreshing: boolean
  refreshError: string | null
  now: number
  bottomInset: number
  onRefresh: () => void
  onAnswer: (worktreeId: string, id: string, reply: OwnerQuestionReply) => Promise<void>
  onOpenLink: (url: string) => void
}

function Placeholder({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <View style={styles.placeholder}>
      {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
      <Text style={styles.placeholderText}>{text}</Text>
    </View>
  )
}

/** The host's open owner questions, one section per project. */
export function GameInboxList(props: GameInboxListProps) {
  const { state } = props
  const body = (() => {
    if (state.kind === 'loading') {
      return <Placeholder text={props.connecting ? 'Connecting…' : 'Loading questions…'} busy />
    }
    if (state.kind === 'unavailable') {
      return <Placeholder text="The Inbox is unavailable on this host — update Orca on it." />
    }
    if (state.kind === 'error') {
      return (
        <View style={styles.placeholder}>
          <Text style={styles.errorText}>{`Could not read the questions — ${state.message}`}</Text>
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            onPress={props.onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <>
        {props.refreshError ? (
          <View style={styles.banner}>
            <Text style={styles.errorText}>{`Could not refresh — ${props.refreshError}`}</Text>
          </View>
        ) : null}
        {state.projects.length === 0 ? (
          <Placeholder text="No questions are waiting for you." />
        ) : (
          state.projects.map((project) => (
            <View key={project.repoId} style={styles.section}>
              <Text style={styles.sectionHeading}>{project.repoName}</Text>
              {project.questions.map((question) => (
                <GameInboxQuestionCard
                  key={question.id}
                  question={question}
                  worktreeId={project.worktreeId}
                  now={props.now}
                  onAnswer={(reply) =>
                    project.worktreeId
                      ? props.onAnswer(project.worktreeId, question.id, reply)
                      : Promise.reject(new Error('Answer this one from Orca on the desktop.'))
                  }
                  onOpenLink={props.onOpenLink}
                />
              ))}
            </View>
          ))
        )}
      </>
    )
  })()

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: props.bottomInset + spacing.xl }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={props.refreshing && state.kind !== 'loading'}
          onRefresh={props.onRefresh}
          tintColor={colors.textSecondary}
        />
      }
    >
      {body}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  section: {
    marginBottom: spacing.xl,
    gap: spacing.sm
  },
  sectionHeading: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.md,
    gap: spacing.md
  },
  placeholderText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    textAlign: 'center'
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    textAlign: 'center'
  },
  banner: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.lg
  },
  retry: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    justifyContent: 'center'
  },
  retryPressed: {
    backgroundColor: colors.borderSubtle
  },
  retryLabel: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  }
})
