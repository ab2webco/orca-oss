import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { Users } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import type { LeadMember } from './lead-members'
import { styles } from './mobile-session-styles'

const STATE_COLOR: Record<LeadMember['state'], string> = {
  working: colors.accentBlue,
  blocked: colors.statusAmber,
  waiting: colors.statusAmber,
  done: colors.statusGreen
}

/** Tab-like entries for the members a lead launched; each opens in its own worktree (ORCA-611). */
export function LeadMembersStrip({
  members,
  onOpen
}: {
  members: readonly LeadMember[]
  onOpen: (member: LeadMember) => void
}) {
  if (members.length === 0) {
    return null
  }
  return (
    <View style={styles.tabBar}>
      <View style={stripStyles.label} accessibilityElementsHidden>
        <Users size={13} color={colors.textMuted} strokeWidth={2.1} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabContent}
        keyboardShouldPersistTaps="handled"
      >
        {members.map((member) => (
          <Pressable
            key={`${member.worktreeId}:${member.tabId}`}
            style={({ pressed }) => [styles.tab, pressed && stripStyles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open member ${member.label}`}
            onPress={() => onOpen(member)}
          >
            <View style={styles.tabLabelRow}>
              <View style={[stripStyles.dot, { backgroundColor: STATE_COLOR[member.state] }]} />
              <Text style={styles.tabText} numberOfLines={1}>
                {member.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const stripStyles = StyleSheet.create({
  label: {
    paddingLeft: spacing.md,
    justifyContent: 'center'
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  pressed: {
    backgroundColor: colors.bgRaised
  }
})
