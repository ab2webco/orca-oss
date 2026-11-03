import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import {
  ChevronDown,
  ChevronsRight,
  Keyboard as KeyboardIcon,
  Monitor,
  Plus,
  Smartphone
} from 'lucide-react-native'
import type { CustomKey } from '../components/CustomKeyModal'
import { HorizontalOverflowCue, useHorizontalOverflow } from '../components/HorizontalOverflowCue'
import { Text } from '../theme/dynamic-type-text'
import { MIN_TOUCH_TARGET, colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { TerminalAccessoryKey } from './terminal-accessory-keys'

export type TerminalAccessoryBarProps = {
  keyboardVisible: boolean
  phoneDisplayMode: boolean
  liveInputEnabled: boolean
  canSend: boolean
  canCompose: boolean
  canPaste: boolean
  builtInKeys: readonly TerminalAccessoryKey[]
  customKeys: readonly CustomKey[]
  onDismissKeyboard: () => void
  onToggleDisplayMode: () => void
  onToggleLiveInput: () => void
  onPaste: () => void
  onKeyPress: (key: TerminalAccessoryKey) => void
  onRepeatStart: (key: TerminalAccessoryKey) => void
  onRepeatStop: () => void
  onCustomKeyPress: (key: CustomKey) => void
  onCustomKeyLongPress: (key: CustomKey) => void
  onAddCustomKey: () => void
}

// Mode toggles stay pinned at the leading edge; only the keys scroll, so the
// controls that change how input works can never scroll out of reach.
export function TerminalAccessoryBar(props: TerminalAccessoryBarProps) {
  const { canSend, canCompose, liveInputEnabled, phoneDisplayMode } = props
  const overflow = useHorizontalOverflow()
  const keyTextStyle = [styles.keyText, !canSend && styles.keyTextDisabled]
  const iconColor = canSend ? colors.textSecondary : colors.textMuted

  return (
    <View style={styles.bar}>
      <View style={styles.pinned}>
        {props.keyboardVisible ? (
          <AccessoryKey
            onPress={props.onDismissKeyboard}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            accessibilityHint="Hides the software keyboard and keeps the current terminal session open."
          >
            <View style={styles.keyboardDismissGlyph}>
              <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
              <ChevronDown
                size={10}
                color={colors.textSecondary}
                strokeWidth={2.5}
                style={styles.keyboardDismissChevron}
              />
            </View>
          </AccessoryKey>
        ) : null}
        <AccessoryKey
          disabled={!canSend}
          onPress={props.onToggleDisplayMode}
          accessibilityLabel={phoneDisplayMode ? 'Switch to desktop mode' : 'Switch to phone mode'}
        >
          {phoneDisplayMode ? (
            <Monitor size={14} color={iconColor} />
          ) : (
            <Smartphone size={14} color={iconColor} />
          )}
        </AccessoryKey>
        <AccessoryKey
          active={liveInputEnabled}
          // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
          disabled={!canCompose}
          onPress={props.onToggleLiveInput}
          accessibilityLabel={
            liveInputEnabled ? 'Switch to buffered command input' : 'Switch to live terminal input'
          }
        >
          <ChevronsRight
            size={14}
            color={
              liveInputEnabled
                ? colors.bgBase
                : canCompose
                  ? colors.textSecondary
                  : colors.textMuted
            }
          />
        </AccessoryKey>
      </View>
      <View style={styles.divider} />
      <View style={styles.strip}>
        {/* Why: default tap handling makes the first accessory-key tap dismiss the keyboard and get swallowed (#5106). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripContent}
          keyboardShouldPersistTaps="always"
          {...overflow.scrollProps}
        >
          {props.canPaste ? (
            <AccessoryKey
              disabled={!canSend}
              onPress={props.onPaste}
              accessibilityLabel="Paste from clipboard"
            >
              <Text style={keyTextStyle}>Paste</Text>
            </AccessoryKey>
          ) : null}
          {props.builtInKeys.map((key) => (
            <AccessoryKey
              key={key.id}
              disabled={!canSend}
              onPressIn={key.repeatable ? () => props.onRepeatStart(key) : undefined}
              onPressOut={key.repeatable ? props.onRepeatStop : undefined}
              onPress={key.repeatable ? undefined : () => props.onKeyPress(key)}
              accessibilityLabel={key.accessibilityLabel ?? `Send ${key.label}`}
            >
              <Text style={keyTextStyle}>{key.label}</Text>
            </AccessoryKey>
          ))}
          {props.customKeys.map((key) => (
            <AccessoryKey
              key={key.id}
              custom
              disabled={!canSend}
              onPress={() => props.onCustomKeyPress(key)}
              onLongPress={() => props.onCustomKeyLongPress(key)}
              accessibilityLabel={`Send ${key.label}`}
            >
              <Text style={keyTextStyle}>{key.label}</Text>
            </AccessoryKey>
          ))}
          <AccessoryKey onPress={props.onAddCustomKey} accessibilityLabel="Add custom shortcut">
            <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
          </AccessoryKey>
        </ScrollView>
        {overflow.overflowing ? <HorizontalOverflowCue name="terminal-accessory" /> : null}
      </View>
    </View>
  )
}

function AccessoryKey({
  active = false,
  custom = false,
  disabled = false,
  children,
  onLongPress,
  ...pressableProps
}: {
  active?: boolean
  custom?: boolean
  disabled?: boolean
  children: ReactNode
  onPress?: () => void
  onPressIn?: () => void
  onPressOut?: () => void
  onLongPress?: () => void
  accessibilityLabel: string
  accessibilityRole?: 'button'
  accessibilityHint?: string
}) {
  return (
    <Pressable
      {...pressableProps}
      style={styles.target}
      disabled={disabled}
      onLongPress={onLongPress}
      delayLongPress={onLongPress ? 400 : undefined}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.key,
            custom && styles.keyCustom,
            active && styles.keyActive,
            pressed && styles.keyPressed,
            disabled && styles.keyDisabled
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  )
}

const KEY_HEIGHT = 32
// Why: half the gap between key faces on each side keeps a 44 pt target without dead space.
const TARGET_INSET = 3

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: KEY_HEIGHT - spacing.sm,
    marginHorizontal: spacing.xs,
    backgroundColor: colors.borderSubtle
  },
  strip: {
    flex: 1,
    minWidth: 0
  },
  stripContent: {
    alignItems: 'center',
    paddingRight: spacing.xs
  },
  target: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: TARGET_INSET,
    alignItems: 'center',
    justifyContent: 'center'
  },
  key: {
    height: KEY_HEIGHT,
    minWidth: MIN_TOUCH_TARGET - TARGET_INSET * 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keyCustom: {
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  keyActive: {
    backgroundColor: colors.textPrimary
  },
  keyPressed: {
    backgroundColor: colors.borderSubtle
  },
  keyDisabled: {
    opacity: 0.35
  },
  keyText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.monoFamily
  },
  keyTextDisabled: {
    color: colors.textMuted
  },
  keyboardDismissGlyph: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'flex-start',
    position: 'relative',
    width: 18
  },
  keyboardDismissChevron: {
    bottom: -2,
    position: 'absolute'
  }
})
