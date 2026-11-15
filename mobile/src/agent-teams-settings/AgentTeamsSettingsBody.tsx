import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Check, ChevronRight, Image, Palette } from 'lucide-react-native'
import type { GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import type { StatusColorTone } from '../../../src/shared/status-colors'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import {
  BUILT_IN_SCENES,
  PANEL_STYLES,
  sceneLabelOf,
  statusColorRowsOf,
  type AgentTeamsSettings
} from './agent-teams-settings-model'
import { StatusColorSheet } from './StatusColorSheet'
import type { AgentTeamsSettingsState } from './use-agent-teams-settings'

type Handlers = {
  onScene: (scene: string) => void
  onStyle: (style: GamePanelStyle) => void
  onToneColor: (tone: StatusColorTone, color: string | null) => void
  onResetColors: () => void
}

function sceneActionsOf(scene: string, onScene: Handlers['onScene']): ActionSheetAction[] {
  const custom = !BUILT_IN_SCENES.some((one) => one.id === scene)
  return [
    ...BUILT_IN_SCENES.map((one) => ({
      label: one.label,
      ...(one.id === scene ? { icon: Check, hint: 'Current' } : { icon: Image }),
      onPress: () => onScene(one.id)
    })),
    {
      label: 'Custom file…',
      // Why disabled: the scene file lives on the desktop, which the phone cannot browse.
      hint: custom
        ? `${sceneLabelOf(scene)} · choose files on the desktop`
        : 'Choose it on the desktop',
      icon: custom ? Check : Image,
      disabled: true,
      onPress: () => {}
    }
  ]
}

function styleActionsOf(style: GamePanelStyle, onStyle: Handlers['onStyle']): ActionSheetAction[] {
  return PANEL_STYLES.map((one) => ({
    label: one.label,
    ...(one.id === style ? { icon: Check, hint: 'Current' } : { icon: Palette }),
    onPress: () => onStyle(one.id)
  }))
}

function NavRow(props: { icon: typeof Image; label: string; value: string; onPress: () => void }) {
  const Icon = props.icon
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={props.onPress}
    >
      <Icon size={16} color={colors.textSecondary} />
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {props.value}
      </Text>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}

function ReadyBody({ settings, ...handlers }: Handlers & { settings: AgentTeamsSettings }) {
  const [open, setOpen] = useState<'scene' | 'style' | StatusColorTone | null>(null)
  const rows = statusColorRowsOf(settings.dark)
  const edited = rows.some((row) => row.edited)
  const close = () => setOpen(null)
  return (
    <>
      <Text style={styles.sectionHeading}>Panel</Text>
      <View style={styles.card}>
        <NavRow
          icon={Image}
          label="Scene"
          value={sceneLabelOf(settings.scene)}
          onPress={() => setOpen('scene')}
        />
        <View style={styles.separator} />
        <NavRow
          icon={Palette}
          label="Scene style"
          value={PANEL_STYLES.find((one) => one.id === settings.style)?.label ?? settings.style}
          onPress={() => setOpen('style')}
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeading}>Status colors</Text>
        <Pressable disabled={!edited} onPress={handlers.onResetColors} hitSlop={8}>
          <Text style={[styles.reset, !edited && styles.resetDisabled]}>Reset</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <View key={row.tone}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${row.name} colour`}
                style={[styles.swatch, { backgroundColor: row.color }]}
                onPress={() => setOpen(row.tone)}
              />
              <View style={styles.toneText}>
                <Text style={styles.rowLabel}>{row.name}</Text>
                {row.warning ? <Text style={styles.warning}>{row.warning}</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </View>

      <ActionSheetModal
        visible={open === 'scene'}
        title="Scene"
        actions={sceneActionsOf(settings.scene, handlers.onScene)}
        onClose={close}
      />
      <ActionSheetModal
        visible={open === 'style'}
        title="Scene style"
        actions={styleActionsOf(settings.style, handlers.onStyle)}
        onClose={close}
      />
      <StatusColorSheet
        row={rows.find((row) => row.tone === open) ?? null}
        onPick={(color) => {
          const tone = rows.find((row) => row.tone === open)?.tone
          if (tone) {
            handlers.onToneColor(tone, color)
          }
        }}
        onClose={close}
      />
    </>
  )
}

/** Settings → Agent Teams (p08): the panel's scene and style, then the five status colours. */
export function AgentTeamsSettingsBody(
  props: Handlers & { state: AgentTeamsSettingsState; hostName: string }
) {
  const { state, hostName, ...handlers } = props
  switch (state.kind) {
    case 'loading':
      return (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      )
    case 'unsupported':
      return (
        <Text
          style={styles.message}
        >{`Update Orca on ${hostName || 'this computer'} to use this`}</Text>
      )
    case 'failed':
      return (
        <Text style={styles.error}>{`Could not read Agent Teams settings: ${state.message}`}</Text>
      )
    case 'ready':
      return (
        <>
          {state.saveError ? <Text style={styles.error}>{state.saveError}</Text> : null}
          <ReadyBody settings={state.settings} {...handlers} />
        </>
      )
  }
}

const styles = StyleSheet.create({
  placeholder: {
    paddingVertical: spacing.xl,
    alignItems: 'center'
  },
  message: {
    paddingVertical: spacing.lg,
    fontSize: typography.bodySize,
    color: colors.textSecondary
  },
  error: {
    paddingBottom: spacing.md,
    fontSize: typography.metaSize,
    color: colors.statusRed
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl
  },
  sectionHeading: {
    paddingBottom: spacing.sm,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  reset: {
    paddingBottom: spacing.sm,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.accentBlue
  },
  resetDisabled: {
    color: colors.textMuted
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  rowValue: {
    flexShrink: 1,
    fontSize: typography.bodySize,
    color: colors.textSecondary
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing.md + 2
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12
  },
  toneText: {
    flex: 1,
    gap: 2
  },
  warning: {
    fontSize: typography.metaSize,
    color: colors.statusAmber
  }
})
