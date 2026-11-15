import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { Text, TextInput } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { STATUS_COLOR_SWATCHES, type StatusColorRow } from './agent-teams-settings-model'

const HEX = /^#[0-9a-f]{6}$/i

/** One role's colour: a default hue from the grid or a typed #rrggbb (approved option A). */
export function StatusColorSheet(props: {
  row: StatusColorRow | null
  onPick: (color: string | null) => void
  onClose: () => void
}) {
  const { row } = props
  const [typed, setTyped] = useState('')
  const typedValid = HEX.test(typed.trim())

  const close = () => {
    setTyped('')
    props.onClose()
  }
  const pick = (color: string | null) => {
    props.onPick(color)
    close()
  }

  return (
    <BottomDrawer visible={row !== null} onClose={close}>
      <Text style={styles.title}>{row ? `${row.name} colour` : ''}</Text>
      <View style={styles.grid}>
        {STATUS_COLOR_SWATCHES.map((hex) => (
          <Pressable
            key={hex}
            accessibilityRole="button"
            accessibilityLabel={hex}
            style={[
              styles.swatch,
              { backgroundColor: hex },
              row?.color === hex && styles.swatchCurrent
            ]}
            onPress={() => pick(hex)}
          />
        ))}
      </View>
      <View style={styles.hexRow}>
        <TextInput
          style={styles.hexInput}
          value={typed}
          onChangeText={setTyped}
          placeholder={row?.color ?? '#rrggbb'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          onSubmitEditing={() => typedValid && pick(typed.trim())}
        />
        <Pressable
          style={[styles.button, !typedValid && styles.buttonDisabled]}
          disabled={!typedValid}
          onPress={() => pick(typed.trim())}
        >
          <Text style={styles.buttonLabel}>Use</Text>
        </Pressable>
      </View>
      {typed.length > 0 && !typedValid ? <Text style={styles.hint}>Use #rrggbb</Text> : null}
      <Pressable
        style={[styles.reset, !row?.edited && styles.buttonDisabled]}
        disabled={!row?.edited}
        onPress={() => pick(null)}
      >
        <Text style={styles.resetLabel}>Default</Text>
      </Pressable>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18
  },
  swatchCurrent: {
    borderWidth: 2,
    borderColor: colors.textPrimary
  },
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  hexInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  button: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.accentBlue,
    justifyContent: 'center'
  },
  buttonDisabled: {
    opacity: 0.4
  },
  buttonLabel: {
    color: colors.onAccent,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  hint: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    fontSize: typography.metaSize,
    color: colors.statusAmber
  },
  reset: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    paddingVertical: spacing.sm
  },
  resetLabel: {
    color: colors.accentBlue,
    fontSize: typography.bodySize,
    fontWeight: '500'
  }
})
