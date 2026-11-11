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
import { inboxMetaStyles as metaStyles, timeAgoOf } from './team-inbox-meta'
import { TeamInboxThreadRow } from './TeamInboxThreadRow'
import type { TeamInboxWords } from './team-inbox-words'

type Props = {
  team: TeamDrawerData
  now: number
  words: TeamInboxWords
  onOpenLink: (url: string) => void
}

function WaitingCard({
  item,
  now,
  words
}: {
  item: GameWaitingItem
  now: number
  words: TeamInboxWords
}) {
  return (
    <View style={styles.card}>
      <View style={metaStyles.meta}>
        <Text style={metaStyles.ticket}>{item.ticket}</Text>
        <Text style={styles.kind}>{words.kind[item.kind]}</Text>
        <Text style={metaStyles.age}>{timeAgoOf(item.at, now, words.justNow) ?? ''}</Text>
      </View>
      <Text style={styles.title}>{item.subject}</Text>
      {item.body && item.body !== item.subject ? (
        <Text style={metaStyles.body} numberOfLines={6}>
          {item.body}
        </Text>
      ) : null}
      {item.answerer !== 'lead' ? (
        <Text style={metaStyles.age}>{words.answeredBy(item.answerer)}</Text>
      ) : null}
    </View>
  )
}

function AnsweredCard({
  item,
  now,
  words
}: {
  item: GameAnsweredItem
  now: number
  words: TeamInboxWords
}) {
  return (
    <View style={styles.card}>
      <View style={metaStyles.meta}>
        <Text style={metaStyles.ticket}>{item.ticket}</Text>
        <Text style={styles.kind}>{words.kind[item.kind]}</Text>
        <Text style={metaStyles.age}>{timeAgoOf(item.answeredAt, now, words.justNow) ?? ''}</Text>
      </View>
      <Text style={styles.title} numberOfLines={4}>
        {item.question}
      </Text>
      <Text style={styles.answer} numberOfLines={6}>
        {item.overriddenBy?.text ?? item.answer}
      </Text>
      {item.overriddenBy ? <Text style={metaStyles.age}>{words.youReplaced}</Text> : null}
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
export function TeamInboxTab({ team, now, words, onOpenLink }: Props) {
  const { questions, inbox } = team
  return (
    <View>
      <Section
        title={words.forYou(questions.length)}
        tone={questions.length > 0 ? 'danger' : undefined}
      >
        {questions.length > 0 ? (
          questions.map((question) => (
            <GameInboxQuestionCard
              key={question.id}
              question={question}
              worktreeId={team.answerWorktreeId}
              now={now}
              words={words}
              onAnswer={(reply) => team.answer(question.id, reply)}
              onOpenLink={onOpenLink}
            />
          ))
        ) : (
          <Text style={styles.empty}>{words.noQuestions}</Text>
        )}
      </Section>
      {inbox.kind === 'loading' ? <Text style={styles.empty}>{words.reading}</Text> : null}
      {inbox.kind === 'unavailable' ? <Text style={styles.empty}>{words.updateOrca}</Text> : null}
      {inbox.kind === 'ready' ? (
        <>
          <Section title={words.waitingOnLead(inbox.threads.waiting.length)}>
            {inbox.threads.waiting.length > 0 ? (
              inbox.threads.waiting.map((item) => (
                <WaitingCard key={item.id} item={item} now={now} words={words} />
              ))
            ) : (
              <Text style={styles.empty}>{words.nothingWaits}</Text>
            )}
          </Section>
          <Section title={words.threads(inbox.threads.threads.length)}>
            {inbox.threads.threads.length > 0 ? (
              inbox.threads.threads.map((thread) => (
                <TeamInboxThreadRow key={thread.ticket} thread={thread} now={now} words={words} />
              ))
            ) : (
              <Text style={styles.empty}>{words.noMemberWrote}</Text>
            )}
          </Section>
          {inbox.threads.answered.length > 0 ? (
            <Section title={words.answered(inbox.threads.answered.length)}>
              {inbox.threads.answered.map((item) => (
                <AnsweredCard key={item.id} item={item} now={now} words={words} />
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
