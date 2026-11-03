import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type {
  GameAnsweredItem,
  GameWaitingItem
} from '../../../src/shared/orchestrator-game-inbox-threads'
import { GameInboxQuestionCard } from '../game-inbox/GameInboxQuestionCard'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { TeamDrawerData } from './team-drawer-model'
import { styles as rowStyles, TeamInboxThreadRow, timeAgoOf } from './TeamInboxThreadRow'

type Props = { team: TeamDrawerData; now: number; onOpenLink: (url: string) => void }

const KIND_LABEL: Record<GameWaitingItem['kind'], string> = {
  question: 'Question',
  decision_gate: 'Decision'
}

function WaitingCard({ item, now }: { item: GameWaitingItem; now: number }) {
  return (
    <View style={styles.card}>
      <View style={rowStyles.meta}>
        <Text style={rowStyles.ticket}>{item.ticket}</Text>
        <Text style={styles.kind}>{KIND_LABEL[item.kind]}</Text>
        <Text style={rowStyles.age}>{timeAgoOf(item.at, now) ?? ''}</Text>
      </View>
      <Text style={styles.title}>{item.subject}</Text>
      {item.body && item.body !== item.subject ? (
        <Text style={rowStyles.body} numberOfLines={6}>
          {item.body}
        </Text>
      ) : null}
      {item.answerer !== 'lead' ? (
        <Text style={rowStyles.age}>{`Answered by ${item.answerer}`}</Text>
      ) : null}
    </View>
  )
}

function AnsweredCard({ item, now }: { item: GameAnsweredItem; now: number }) {
  return (
    <View style={styles.card}>
      <View style={rowStyles.meta}>
        <Text style={rowStyles.ticket}>{item.ticket}</Text>
        <Text style={styles.kind}>{KIND_LABEL[item.kind]}</Text>
        <Text style={rowStyles.age}>{timeAgoOf(item.answeredAt, now) ?? ''}</Text>
      </View>
      <Text style={styles.title} numberOfLines={4}>
        {item.question}
      </Text>
      <Text style={styles.answer} numberOfLines={6}>
        {item.overriddenBy?.text ?? item.answer}
      </Text>
      {item.overriddenBy ? <Text style={rowStyles.age}>You replaced the lead's answer</Text> : null}
    </View>
  )
}

function Section({
  title,
  tone,
  children
}: {
  title: string
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, tone === 'danger' && styles.danger]}>{title}</Text>
      {children}
    </View>
  )
}

/** The lead's Inbox on the phone: the desktop sheet's lists, read-only except the owner's answers. */
export function TeamInboxTab({ team, now, onOpenLink }: Props) {
  const { questions, inbox } = team
  return (
    <View>
      <Section
        title={`For you (${questions.length})`}
        tone={questions.length > 0 ? 'danger' : undefined}
      >
        {questions.length > 0 ? (
          questions.map((question) => (
            <GameInboxQuestionCard
              key={question.id}
              question={question}
              worktreeId={team.answerWorktreeId}
              now={now}
              onAnswer={(reply) => team.answer(question.id, reply)}
              onOpenLink={onOpenLink}
            />
          ))
        ) : (
          <Text style={styles.empty}>No questions are waiting for you.</Text>
        )}
      </Section>
      {inbox.kind === 'loading' ? (
        <Text style={styles.empty}>Reading the lead's Inbox…</Text>
      ) : null}
      {inbox.kind === 'unavailable' ? (
        <Text style={styles.empty}>
          Update Orca on this computer to read the lead's Inbox here.
        </Text>
      ) : null}
      {inbox.kind === 'ready' ? (
        <>
          <Section title={`Waiting on the lead (${inbox.threads.waiting.length})`}>
            {inbox.threads.waiting.length > 0 ? (
              inbox.threads.waiting.map((item) => (
                <WaitingCard key={item.id} item={item} now={now} />
              ))
            ) : (
              <Text style={styles.empty}>Nothing waits on the lead.</Text>
            )}
          </Section>
          <Section title={`Threads (${inbox.threads.threads.length})`}>
            {inbox.threads.threads.length > 0 ? (
              inbox.threads.threads.map((thread) => (
                <TeamInboxThreadRow key={thread.ticket} thread={thread} now={now} />
              ))
            ) : (
              <Text style={styles.empty}>No member has written yet.</Text>
            )}
          </Section>
          {inbox.threads.answered.length > 0 ? (
            <Section title={`Answered (${inbox.threads.answered.length})`}>
              {inbox.threads.answered.map((item) => (
                <AnsweredCard key={item.id} item={item} now={now} />
              ))}
            </Section>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
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
  danger: {
    color: colors.statusRed
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.bodySize,
    marginBottom: spacing.lg
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.xs
  },
  kind: {
    color: colors.statusAmber,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodySize + 1,
    fontWeight: '600'
  },
  answer: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    lineHeight: 20
  }
})
