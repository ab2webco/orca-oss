import { Settings } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'
import { MIN_TOUCH_TARGET, colors } from '../theme/mobile-theme'

export function HomeSettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
    >
      <Settings size={18} color={colors.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonPressed: {
    backgroundColor: colors.bgRaised
  }
})
