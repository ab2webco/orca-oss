import { Image, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { TeamMemberRow } from './team-drawer-model'
import type { TeamSceneBand as Band, TeamSceneBandActor } from './team-scene-band'
import { teamSceneQuestArtOf, type TeamSceneQuestArt } from './team-scene-quest-art'

/** Fixed, so the sheet does not jump when the art decodes or falls back. */
export const TEAM_SCENE_BAND_HEIGHT = 128

// Why these numbers: the desktop stage is 176 px with feet 14 px over its bottom and figures 60 px tall
// (team-scene-image-painter.ts, Quest's native.json); the band draws the same stage scaled down.
const SCALE = TEAM_SCENE_BAND_HEIGHT / 176
const FRAME = 128
const FEET = { x: 64, y: 122 }
const PX = (60 / FRAME) * SCALE
const FEET_Y = TEAM_SCENE_BAND_HEIGHT - 14 * SCALE

const sourceOf = (art: TeamSceneQuestArt, actor: TeamSceneBandActor) =>
  actor.role === 'lead'
    ? art.lead
    : actor.role === 'advisor'
      ? art.advisor
      : (art.members[actor.sheet % art.members.length] ?? art.lead)

const TONE: Record<TeamMemberRow['state'], string> = {
  waiting: colors.statusRed,
  working: colors.statusGreen,
  idle: colors.textMuted,
  done: colors.statusPurple
}

function ReadableBand({
  leadName,
  members
}: {
  leadName: string | null
  members: TeamMemberRow[]
}) {
  const names = [
    ...(leadName ? [{ key: 'lead', name: leadName, tone: colors.textSecondary }] : []),
    ...members.map((one) => ({
      key: one.key,
      name: one.name,
      tone: one.needsYou ? colors.statusRed : TONE[one.state]
    }))
  ]
  return (
    <View testID="team-scene-band" style={[styles.band, styles.readable]}>
      {names.map((one) => (
        <View key={one.key} style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: one.tone }]} />
          <Text style={styles.name} numberOfLines={1}>
            {one.name}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** The Game look's stage at phone size: Orca's art when it can draw, else the names. */
export function TeamSceneBand({
  band,
  leadName,
  members
}: {
  band: Band
  leadName: string | null
  members: TeamMemberRow[]
}) {
  if (band.kind === 'readable') {
    return <ReadableBand leadName={leadName} members={members} />
  }
  const art = teamSceneQuestArtOf(band.style)
  const count = band.actors.length
  return (
    <View
      testID="team-scene-band"
      style={styles.band}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={art.backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {band.actors.map((actor, at) => (
        <Image
          key={actor.key}
          testID="team-scene-actor"
          source={sourceOf(art, actor)}
          style={[
            styles.actor,
            { left: `${((at + 1) / (count + 1)) * 100}%`, top: FEET_Y - FEET.y * PX }
          ]}
        />
      ))}
      {art.front ? (
        <Image source={art.front} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  band: {
    height: TEAM_SCENE_BAND_HEIGHT,
    marginHorizontal: -spacing.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgBase
  },
  actor: {
    position: 'absolute',
    width: FRAME * PX,
    height: FRAME * PX,
    marginLeft: -FEET.x * PX
  },
  readable: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  name: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  }
})
