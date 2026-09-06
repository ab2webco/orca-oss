import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Copy, ExternalLink } from 'lucide-react-native'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { formatUpdatedAt } from './task-updated-at-time'
import type { PlaneTaskItem } from './plane-mobile-task-list'
import { PLANE_PRIORITY_LABELS } from './plane-priority-label'

type Props = {
  item: PlaneTaskItem
  onOpenInBrowser: (url: string) => void
  onCopyLink?: (url: string) => void
  copied?: boolean
}

function planeStateLabel(state: PlaneTaskItem['source']['state']): string {
  const name = state.name || state.group || 'Unknown'
  return state.group && state.group !== state.name ? `${name} · ${state.group}` : name
}

function planeProjectLabel(project: PlaneTaskItem['source']['project']): string {
  return [project.identifier, project.name].filter(Boolean).join(' · ') || 'Unknown project'
}

/** Read-only Plane work item detail. Mutations are ORCA-357; this only reads and opens. */
export function PlaneWorkItemDetail({ item, onOpenInBrowser, onCopyLink, copied }: Props) {
  const work = item.source
  const url = work.url
  const fields: [string, string][] = [
    ['Identifier', work.identifier || '—'],
    ['State', planeStateLabel(work.state)],
    ['Priority', PLANE_PRIORITY_LABELS[work.priority]],
    ['Project', planeProjectLabel(work.project)],
    ['Updated', formatUpdatedAt(work.updatedAt) || '—']
  ]
  const description = work.description?.trim()
  return (
    <View>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <TaskProviderLogo provider="plane" size={16} color={colors.textPrimary} />
          <Text style={styles.title} numberOfLines={3}>
            {item.title}
          </Text>
        </View>
        <Text style={styles.subtitle}>Plane work item</Text>
      </View>
      <View style={styles.metaGrid}>
        {fields.map(([label, value]) => (
          <View key={label} style={styles.metaItem}>
            <Text style={styles.metaLabel}>{label}</Text>
            <Text style={styles.metaValue}>{value}</Text>
          </View>
        ))}
      </View>
      {description ? (
        <View style={styles.body}>
          <Text style={styles.bodyLabel}>Description</Text>
          {/* Raw markdown, not rendered: triage needs the words, not a WebView. */}
          <Text style={styles.bodyText}>{description}</Text>
        </View>
      ) : null}
      {url ? (
        <View style={styles.actions}>
          <View style={styles.actionSeparator} />
          <Pressable
            accessibilityRole="button"
            style={styles.actionRow}
            onPress={() => onOpenInBrowser(url)}
          >
            <ExternalLink size={16} color={colors.textPrimary} />
            <Text style={styles.actionText}>Open in Plane</Text>
          </Pressable>
          {onCopyLink ? (
            <>
              <View style={styles.actionSeparator} />
              <Pressable
                accessibilityRole="button"
                style={styles.actionRow}
                onPress={() => onCopyLink(url)}
              >
                <Copy size={16} color={colors.textPrimary} />
                <Text style={styles.actionText}>{copied ? 'Copied' : 'Copy link'}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 20
  },
  subtitle: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    marginTop: 2
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  metaItem: {
    minWidth: 96,
    flexGrow: 1
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2
  },
  metaValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600'
  },
  body: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs
  },
  bodyLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.xs
  },
  bodyText: {
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    lineHeight: 20
  },
  actions: {
    marginTop: spacing.md
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  actionText: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  actionSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
