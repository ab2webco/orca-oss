import { ChevronDown, ChevronRight, Pin } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import type { RepoIcon } from '../../../src/shared/repo-icon'
import { MIN_TOUCH_TARGET, colors, spacing } from '../theme/mobile-theme'
import { MobileRepoIcon } from './MobileRepoIcon'

type Props = {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  pinned?: boolean
  // Present only when the list is grouped by repo.
  repo?: { icon: RepoIcon | null | undefined; color: string | null | undefined }
}

export function WorkspaceSectionHeader({ title, count, collapsed, onToggle, pinned, repo }: Props) {
  return (
    <Pressable
      style={styles.sectionHeader}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      accessibilityState={{ expanded: !collapsed }}
    >
      {collapsed ? (
        <ChevronRight size={12} color={colors.textMuted} style={styles.sectionIcon} />
      ) : (
        <ChevronDown size={12} color={colors.textMuted} style={styles.sectionIcon} />
      )}
      {pinned ? <Pin size={12} color={colors.textMuted} style={styles.sectionIcon} /> : null}
      {repo ? (
        <View style={styles.sectionIcon}>
          <MobileRepoIcon
            repoIcon={repo.icon}
            size={14}
            color={repo.color ?? colors.textSecondary}
          />
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs
  },
  sectionIcon: {
    marginRight: spacing.xs
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  sectionCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: spacing.xs
  }
})
