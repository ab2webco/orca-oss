import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Linking from 'expo-linking'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { createPlaneTask } from '../tasks/plane-mobile-task-list'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PlaneWorkItemDetail } from '../tasks/plane-work-item-detail'
import { PLANE_PRIORITY_LABELS, PLANE_PRIORITY_PICKER_ORDER } from '../tasks/plane-priority-label'
import {
  memberDisplayName,
  memberInitials,
  toggledAssignees
} from './plane-assignee-picker-options'
import { PlaneAssigneePickerSheet } from './plane-assignee-picker-sheet'
import { PlaneBoardCommentComposer } from './plane-board-comment-composer'
import { PlaneBoardCommentThreadSection } from './plane-board-comment-thread-section'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'
import { PlaneWorkItemFieldEditor } from './plane-work-item-field-editor'
import type { PlaneBoard } from './use-plane-board'

type Props = {
  /** The live card, so an optimistic edit shows here as well as on the board. */
  item: PlaneMobileWorkItem | null
  board: PlaneBoard
  /** False while the relay is down: the card stays on screen, but it is the last read. */
  planeConnected: boolean
  onMove: (stateId: string) => void
  onClose: () => void
  /** Copy the card's share link; omitted hides the action, as GitHub/Linear also do. */
  onCopyLink?: (url: string) => void
  copied?: boolean
}

export function PlaneWorkItemDetailSheet({
  item,
  board,
  planeConnected,
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
          planeConnected={planeConnected}
          onMove={onMove}
          onCopyLink={onCopyLink}
          copied={copied}
        />
      ) : null}
    </BottomDrawer>
  )
}

type BodyProps = Omit<Props, 'item' | 'onClose'> & { item: PlaneMobileWorkItem }

function SheetBody({ item, board, planeConnected, onMove, onCopyLink, copied }: BodyProps) {
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
      {planeConnected ? null : (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>
            Offline — this is the last read of the card. Comments and edits resume on reconnect.
          </Text>
        </View>
      )}
      <PlaneWorkItemDetail
        item={createPlaneTask(item)}
        onOpenInBrowser={(url) => void Linking.openURL(url)}
        onCopyLink={onCopyLink}
        copied={copied}
      />
      {board.canEdit ? (
        <PlaneWorkItemFieldEditor
          item={item}
          editing={editing}
          clearable={board.canClearDates}
          onSave={(edit) => void board.setFields(item, edit)}
        />
      ) : null}
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
            <AssigneeSummary
              key={item.id}
              item={item}
              members={board.members}
              editing={editing}
              onToggle={(member) =>
                void board.setAssignees(item, toggledAssignees(item.assignees, member))
              }
            />
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
        {board.status === 'loading' || board.columnsPending ? (
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

type AssigneeSummaryProps = {
  item: PlaneMobileWorkItem
  members: readonly PlaneMobileMember[]
  editing: boolean
  onToggle: (member: PlaneMobileMember) => void
}

/** The assigned members as chips; the list of everyone lives in the picker sheet. */
function AssigneeSummary({ item, members, editing, onToggle }: AssigneeSummaryProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <>
      <View style={styles.chips}>
        {item.assignees.length === 0 ? (
          <Text style={styles.chipNote}>Nobody assigned</Text>
        ) : (
          item.assignees.map((assignee) => (
            <View key={assignee.id} style={[styles.chip, styles.assigneeChip]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{memberInitials(assignee.displayName)}</Text>
              </View>
              <Text style={styles.chipText}>{memberDisplayName(assignee)}</Text>
            </View>
          ))
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit assignees"
          style={[styles.chip, styles.chipActive]}
          onPress={() => setPickerOpen(true)}
        >
          <Text style={[styles.chipText, styles.chipTextActive]}>
            {item.assignees.length === 0 ? 'Add' : 'Edit'}
          </Text>
        </Pressable>
      </View>
      <PlaneAssigneePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        members={members}
        assignees={item.assignees}
        disabled={editing}
        onToggle={onToggle}
      />
    </>
  )
}

const styles = StyleSheet.create({
  offline: {
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.row,
    backgroundColor: colors.bgPanel
  },
  offlineText: { fontSize: typography.metaSize, color: colors.textSecondary },
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
  chipNote: { fontSize: typography.metaSize, color: colors.textMuted, alignSelf: 'center' },
  assigneeChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  avatarText: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  rowText: { fontSize: typography.bodySize, color: colors.textPrimary },
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
