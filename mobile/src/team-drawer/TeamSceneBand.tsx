import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { TeamMemberRow } from './team-drawer-model'
import type { TeamSceneBand as Band, TeamSceneBandActor } from './team-scene-band'
import { teamSceneQuestArtOf } from './team-scene-quest-art'
import { teamSceneRoleOf, type TeamSceneArtLoad } from './use-team-scene-art'
import { MEMBER_STATE_ROLE, useTeamTones } from './team-status-tone'

/** Fixed, so the sheet does not jump when the art decodes or falls back. */
export const TEAM_SCENE_BAND_HEIGHT = 128

// Why these numbers: the desktop stage is 176 px with feet 14 px over its bottom, and a role's `size`
// is its drawn height there (team-scene-image-painter.ts); the band draws that stage scaled down.
const SCALE = TEAM_SCENE_BAND_HEIGHT / 176
const FEET_Y = TEAM_SCENE_BAND_HEIGHT - 14 * SCALE

type Sheet = { source: ImageSourcePropType; width: number; height: number }
type Figure = {
  sheet: Sheet
  frame: { width: number; height: number }
  feet: { x: number; y: number }
  size: number
  row: number
}
/** What a stage draws: back layers, one figure per actor, then front layers. */
type Stage = {
  back: ImageSourcePropType[]
  front: ImageSourcePropType[]
  figureOf: (actor: TeamSceneBandActor) => Figure
}

// Why one frame: the build script keeps the idle frame of each Quest sheet, 128 px with feet at 64,122.
function questStage(style: 'figures' | 'office'): Stage {
  const art = teamSceneQuestArtOf(style)
  const frame = { width: 128, height: 128 }
  return {
    back: [art.backdrop],
    front: art.front ? [art.front] : [],
    figureOf: (actor) => ({
      sheet: {
        source:
          actor.role === 'lead'
            ? art.lead
            : actor.role === 'advisor'
              ? art.advisor
              : (art.members[actor.seed % art.members.length] ?? art.lead),
        ...frame
      },
      frame,
      feet: { x: 64, y: 122 },
      size: 60,
      row: 0
    })
  }
}

function sceneStage(
  band: Extract<Band, { kind: 'scene' }>,
  images: ReadonlyMap<string, { uri: string; width: number; height: number }>
): Stage {
  const sheetOf = (src: string): Sheet => {
    const image = images.get(src)!
    return { source: { uri: image.uri }, width: image.width, height: image.height }
  }
  const layers = band.native.layers
  return {
    back: layers.filter((one) => !one.front).map((one) => sheetOf(one.src).source),
    front: layers.filter((one) => one.front).map((one) => sheetOf(one.src).source),
    figureOf: (actor) => {
      const { role, sheet } = teamSceneRoleOf(band.native, actor)
      return {
        sheet: sheetOf(sheet),
        frame: role.frame,
        feet: role.feet ?? { x: role.frame.width / 2, y: role.frame.height },
        size: role.size,
        row: role.animations.idle.row
      }
    }
  }
}

function StageBand({ stage, actors }: { stage: Stage; actors: TeamSceneBandActor[] }) {
  return (
    <View
      testID="team-scene-band"
      style={styles.band}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {stage.back.map((source, at) => (
        <Image
          key={`back-${at}`}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ))}
      {actors.map((actor, at) => {
        const { sheet, frame, feet, size, row } = stage.figureOf(actor)
        const px = (size / frame.height) * SCALE
        return (
          <View
            key={actor.key}
            testID="team-scene-actor"
            style={[
              styles.actor,
              {
                width: frame.width * px,
                height: frame.height * px,
                left: `${((at + 1) / (actors.length + 1)) * 100}%`,
                marginLeft: -feet.x * px,
                top: FEET_Y - feet.y * px
              }
            ]}
          >
            <Image
              source={sheet.source}
              style={[
                styles.sheet,
                {
                  top: -row * frame.height * px,
                  width: sheet.width * px,
                  height: sheet.height * px
                }
              ]}
            />
          </View>
        )
      })}
      {stage.front.map((source, at) => (
        <Image
          key={`front-${at}`}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ))}
    </View>
  )
}

function ReadableBand({
  leadName,
  members
}: {
  leadName: string | null
  members: TeamMemberRow[]
}) {
  const tones = useTeamTones()
  const names = [
    ...(leadName ? [{ key: 'lead', name: leadName, tone: colors.textSecondary }] : []),
    ...members.map((one) => ({
      key: one.key,
      name: one.name,
      tone: tones[one.needsYou ? 'attention' : MEMBER_STATE_ROLE[one.state]]
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

/** The Game look's stage at phone size: the scene's art or Orca's when it can draw, else the names. */
export function TeamSceneBand({
  band,
  ownArt,
  leadName,
  members
}: {
  band: Band
  /** The scene file's images, for a `scene` band. */
  ownArt: TeamSceneArtLoad | null
  leadName: string | null
  members: TeamMemberRow[]
}) {
  if (band.kind === 'scene') {
    if (ownArt?.kind === 'ready') {
      return <StageBand stage={sceneStage(band, ownArt.images)} actors={band.actors} />
    }
    if (ownArt?.kind === 'failed') {
      return (
        <TeamSceneBand band={band.fallback} ownArt={null} leadName={leadName} members={members} />
      )
    }
    return <View testID="team-scene-band" style={styles.band} />
  }
  if (band.kind === 'readable') {
    return <ReadableBand leadName={leadName} members={members} />
  }
  return <StageBand stage={questStage(band.style)} actors={band.actors} />
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
    overflow: 'hidden'
  },
  sheet: {
    position: 'absolute',
    left: 0
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
