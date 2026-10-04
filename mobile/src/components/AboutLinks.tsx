import { Fragment, type ReactNode } from 'react'
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native'
import { UserRound } from 'lucide-react-native'
import Svg, { Path } from 'react-native-svg'
import { ORCA_REPOSITORY_LABEL, ORCA_REPOSITORY_URL } from '../../../src/shared/orca-repository-url'
import { colors, spacing, typography } from '../theme/mobile-theme'

function GithubIcon({ size = 16, color = colors.textSecondary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </Svg>
  )
}

function XIcon({ size = 16, color = colors.textSecondary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </Svg>
  )
}

type AboutRow = {
  key: string
  icon: ReactNode
  label: string
  url: string | null
}

const AUTHOR_NAME = 'Fabian Altahona'
const AUTHOR_X_HANDLE = 'fabolivar23'

const ABOUT_ROWS: readonly AboutRow[] = [
  {
    key: 'author',
    icon: <UserRound size={16} color={colors.textSecondary} />,
    label: AUTHOR_NAME,
    url: null
  },
  {
    key: 'github',
    icon: <GithubIcon />,
    label: ORCA_REPOSITORY_LABEL.replace('github.com/', ''),
    url: ORCA_REPOSITORY_URL
  },
  {
    key: 'x',
    icon: <XIcon />,
    label: `@${AUTHOR_X_HANDLE}`,
    url: `https://x.com/${AUTHOR_X_HANDLE}`
  }
]

function AboutRowView({ row }: { row: AboutRow }) {
  const content = (
    <>
      {row.icon}
      <Text style={styles.rowValue}>{row.label}</Text>
    </>
  )
  const url = row.url
  if (url === null) {
    return <View style={styles.row}>{content}</View>
  }
  return (
    <Pressable
      accessibilityRole="link"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => void Linking.openURL(url)}
    >
      {content}
    </Pressable>
  )
}

export function AboutLinks() {
  return (
    <View style={styles.section}>
      {ABOUT_ROWS.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <AboutRowView row={row} />
        </Fragment>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: typography.bodySize,
    color: colors.textSecondary
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
