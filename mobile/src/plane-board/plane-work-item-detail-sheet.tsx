import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Linking from 'expo-linking'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { createPlaneTask } from '../tasks/plane-mobile-task-list'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PlaneWorkItemDetail } from '../tasks/plane-work-item-detail'
import { PLANE_PRIORITY_LABELS, PLANE_PRIORITY_PICKER_ORDER } from '../tasks/plane-priority-label'
import { PlaneBoardCommentComposer } from './plane-board-comment-composer'
import { PlaneBoardCommentThreadSection } from './plane-board-comment-thread-section'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'
import type { PlaneBoard } from './use-plane-board'

type Props = {
  /** The live card, so an optimistic edit shows here as well as on the board. */
  item: PlaneMobileWorkItem | null
  board: PlaneBoard
  onMove: (stateId: string) => void
  onClose: () => void
  /** Copy the card's share link; omitted hides the action, as GitHub/Linear also do. */
  onCopyLink?: (url: string) => void
  copied?: boolean
}

export function PlaneWorkItemDetailSheet({
  item,
  board,
  onMove,
  onClose,
  onCopyLink,
  copied
}: Props) {
  return (
    <BottomDrawer visible={item !== null} onClose={onClose}>
      {item ? (
        <SheetBody
          item={item}
          board={board}
          onMove={onMove}
          onCopyLink={onCopyLink}
          copied={copied}
        />
      ) : null}
    </BottomDrawer>
  )
}

function toggledAssignees(
  assignees: readonly PlaneMobileMember[],
  member: PlaneMobileMember
): PlaneMobileMember[] {
  return assignees.some((assignee) => assignee.id === member.id)
    ? assignees.filter((assignee) => assignee.id !== member.id)
    : [...assignees, member]
}

type BodyProps = Omit<Props, 'item' | 'onClose'> & { item: PlaneMobileWorkItem }

function SheetBody({ item, board, onMove, onCopyLink, copied }: BodyProps) {
  const editing = board.editingWorkItemIds.has(item.id)
  const moving = board.movingWorkItemIds.has(item.id)
  const failure = board.commentFailures[item.id] ?? null
  const { canAssign, canReadComments, loadMembers, loadCommentThread } = board
  const projectId = item.project.id
  useEffect(() => {
    if (canAssign) {
      loadMembers()
    }
  }, [canAssign, loadMembers, item.id])
  useEffect(() => {
    if (canReadComments) {
      loadCommentThread(item.id, projectId)
    }
  }, [canReadComments, item.id, loadCommentThread, projectId])

  return (
    <View>
      <PlaneWorkItemDetail
        item={createPlaneTask(item)}
        onOpenInBrowser={(url) => void Linking.openURL(url)}
        onCopyLink={onCopyLink}
        copied={copied}
      />
      {board.canEdit ? (
        <View style={styles.section}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chips}>
            {PLANE_PRIORITY_PICKER_ORDER.map((priority) => {
              const active = item.priority === priority
              return (
                <Pressable
                  key={priority}
                  accessibilityRole="button"
                  accessibilityLabel={`Priority ${PLANE_PRIORITY_LABELS[priority]}`}
                  aria-selected={active}
                  disabled={editing || active}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => void board.setPriority(item, priority)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {PLANE_PRIORITY_LABELS[priority]}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}
      {board.canAssign ? (
        <View style={styles.section}>
          <Text style={styles.label}>Assignees</Text>
          {board.membersStatus === 'loading' ? (
            <Text style={styles.note}>Loading members…</Text>
          ) : board.membersStatus === 'error' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry members"
              style={styles.row}
              onPress={board.loadMembers}
            >
              <Text style={styles.errorText}>Could not load the members</Text>
              <Text style={styles.rowMeta}>Retry</Text>
            </Pressable>
          ) : board.members.length === 0 ? (
            <Text style={styles.note}>This project has no members to assign.</Text>
          ) : (
            board.members.map((member) => {
              const assigned = item.assignees.some((assignee) => assignee.id === member.id)
              const name = member.displayName || 'Unnamed member'
              return (
                <Pressable
                  key={member.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${assigned ? 'Unassign' : 'Assign'} ${name}`}
                  aria-checked={assigned}
                  disabled={editing}
                  style={styles.row}
                  onPress={() =>
                    void board.setAssignees(item, toggledAssignees(item.assignees, member))
                  }
                >
                  <Text style={[styles.rowText, assigned && styles.rowTextActive]}>{name}</Text>
                  {assigned ? <Text style={styles.rowMeta}>Assigned</Text> : null}
                </Pressable>
              )
            })
          )}
        </View>
      ) : null}
      {editing ? <Text style={styles.pending}>Updating…</Text> : null}
      {board.editError && board.editErrorWorkItemId === item.id ? (
        <PlaneBoardWriteErrorRow
          message={`Could not update the card — ${board.editError}`}
          onRetry={() => void board.retryEdit()}
          onDismiss={board.dismissEditError}
        />
      ) : null}
      {canReadComments ? (
        <PlaneBoardCommentThreadSection
          thread={board.commentThreadFor(item.id)}
          onRetry={() => board.reloadCommentThread(item.id, projectId)}
        />
      ) : null}
      {board.canComment ? (
        <PlaneBoardCommentComposer
          key={item.id}
          posting={board.postingCommentIds.has(item.id)}
          initialDraft={failure?.body ?? ''}
          error={failure?.message ?? null}
          onPost={(body) => board.addComment(item, body)}
          onRetry={failure?.retryable ? () => board.retryComment(item) : null}
          onDismissError={() => board.dismissCommentError(item.id)}
        />
      ) : null}
      {board.moveError && board.moveErrorWorkItemId === item.id ? (
        <PlaneBoardWriteErrorRow
          message={`Could not move the card — ${board.moveError}`}
          onRetry={null}
          onDismiss={board.dismissMoveError}
        />
      ) : null}
      <View style={styles.section}>
        <Text style={styles.label}>Move to</Text>
        {board.status === 'loading' ? (
          // In list mode the board only reads this card's project on open, so columns are
          // empty during that round trip — don't claim "one column" until it settles.
          <Text style={styles.note}>Loading the board…</Text>
        ) : board.status === 'error' ? (
          // PlaneTaskBoard is not mounted in list mode, so the read error surfaces here.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading the board"
            style={styles.row}
            onPress={board.refresh}
          >
            <Text style={styles.errorText}>{board.error ?? 'Could not load the board'}</Text>
            <Text style={styles.rowMeta}>Retry</Text>
          </Pressable>
        ) : (
          <>
            {board.columns
              .filter((column) => column.stateId !== item.state.id)
              .map((column) => (
                <Pressable
                  key={column.stateId}
                  accessibilityRole="button"
                  accessibilityLabel={`Move to ${column.name}`}
                  disabled={moving}
                  style={styles.row}
                  onPress={() => onMove(column.stateId)}
                >
                  <Text style={styles.rowText}>{column.name}</Text>
                  <Text style={styles.rowMeta}>{column.items.length}</Text>
                </Pressable>
              ))}
            {board.columns.length < 2 ? (
              <Text style={styles.note}>
                This project has only one column, so there is nowhere to move this card.
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.xs
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 2
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  // Selection is weight and surface, not hue: color is reserved for state.
  chipActive: { backgroundColor: colors.bgRaised },
  chipText: { fontSize: typography.metaSize, color: colors.textSecondary },
  chipTextActive: { color: colors.textPrimary, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  rowText: { fontSize: typography.bodySize, color: colors.textPrimary },
  rowTextActive: { fontWeight: '700' },
  rowMeta: { fontSize: typography.metaSize, color: colors.textMuted },
  note: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.md
  },
  errorText: { fontSize: typography.metaSize, color: colors.statusRed },
  pending: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm
  }
})
