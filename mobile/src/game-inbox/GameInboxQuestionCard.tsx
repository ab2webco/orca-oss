import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import type { GameOwnerQuestion } from '../../../src/shared/orchestrator-game-owner-questions'
import { Text, TextInput } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { formatTimeAgo } from '../worktree/agent-row-display'
import { ownerQuestionContextLink, type OwnerQuestionReply } from './game-owner-questions-rpc'
import { QUESTION_CARD_ENGLISH, type QuestionCardWords } from '../team-drawer/team-inbox-words'

type Props = {
  question: GameOwnerQuestion
  /** null: the host has no worktree for this project, so the phone cannot answer it. */
  worktreeId: string | null
  now: number
  onAnswer: (reply: OwnerQuestionReply) => Promise<void>
  onOpenLink: (url: string) => void
  words?: QuestionCardWords
}

export function GameInboxQuestionCard({
  question,
  worktreeId,
  now,
  onAnswer,
  onOpenLink,
  words = QUESTION_CARD_ENGLISH
}: Props) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerable = worktreeId !== null
  const askedAt = Date.parse(question.askedAt)
  const age = Number.isNaN(askedAt) ? null : formatTimeAgo(askedAt, now, words.justNow)
  const link = ownerQuestionContextLink(question.context)

  const send = async (reply: OwnerQuestionReply, clearDraft: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onAnswer(reply)
      if (clearDraft) {
        setDraft('')
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      {question.ticket || age ? (
        <View style={styles.meta}>
          {question.ticket ? <Text style={styles.ticket}>{question.ticket}</Text> : null}
          {age ? <Text style={styles.age}>{age}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.question}>{question.question}</Text>
      {link ? (
        <Pressable
          onPress={() => onOpenLink(link)}
          accessibilityRole="link"
          accessibilityLabel={words.openLink(link)}
          hitSlop={8}
        >
          <Text style={styles.link} numberOfLines={2}>
            {link}
          </Text>
        </Pressable>
      ) : question.context ? (
        <Text style={styles.context}>{question.context}</Text>
      ) : null}
      {question.options.length > 0 ? (
        <View style={styles.options}>
          {question.options.map((option, index) => (
            <Pressable
              key={option}
              style={({ pressed }) => [
                styles.option,
                pressed && styles.optionPressed,
                (!answerable || busy) && styles.disabled
              ]}
              onPress={() => void send({ option: index + 1 }, false)}
              disabled={!answerable || busy}
              accessibilityRole="button"
              accessibilityLabel={words.answerOption(option)}
              accessibilityState={{ disabled: !answerable || busy }}
            >
              <Text style={styles.optionLabel}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {answerable ? (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={words.typeAnswer}
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!busy}
            accessibilityLabel={words.typedAnswer}
          />
          <Pressable
            style={({ pressed }) => [
              styles.send,
              pressed && styles.sendPressed,
              (busy || draft.trim() === '') && styles.disabled
            ]}
            onPress={() => void send({ text: draft }, true)}
            disabled={busy || draft.trim() === ''}
            accessibilityRole="button"
            accessibilityLabel={words.sendAnswer}
            accessibilityState={{ disabled: busy || draft.trim() === '', busy }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Text style={styles.sendLabel}>{words.send}</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Text style={styles.note}>{words.answerOnDesktop}</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm
  },
  ticket: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  age: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  question: {
    color: colors.textPrimary,
    fontSize: typography.bodySize + 1,
    lineHeight: 21
  },
  link: {
    color: colors.accentBlue,
    fontSize: typography.metaSize + 1
  },
  context: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
    backgroundColor: colors.bgRaised,
    justifyContent: 'center'
  },
  optionPressed: {
    backgroundColor: colors.borderSubtle
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.bgBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  send: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sendPressed: {
    opacity: 0.85
  },
  sendLabel: {
    color: colors.onAccent,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  disabled: {
    opacity: 0.45
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  error: {
    color: colors.statusRed,
    fontSize: typography.metaSize
  }
})
