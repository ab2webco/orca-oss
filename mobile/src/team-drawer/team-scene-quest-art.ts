import type { ImageSourcePropType } from 'react-native'

export type TeamSceneQuestArt = {
  backdrop: ImageSourcePropType
  /** Drawn over the figures, as the desktop's front layer. */
  front: ImageSourcePropType | null
  lead: ImageSourcePropType
  advisor: ImageSourcePropType
  members: ImageSourcePropType[]
}

// Why still frames: built from the desktop's sheets by scripts/build-team-scene-art.mjs.
const FIGURES: TeamSceneQuestArt = {
  backdrop: require('../../assets/team-scene/quest/figures/backdrop.png'),
  front: require('../../assets/team-scene/quest/figures/front.png'),
  lead: require('../../assets/team-scene/quest/figures/lead.png'),
  advisor: require('../../assets/team-scene/quest/figures/advisor.png'),
  members: [
    require('../../assets/team-scene/quest/figures/member-1.png'),
    require('../../assets/team-scene/quest/figures/member-2.png'),
    require('../../assets/team-scene/quest/figures/member-3.png'),
    require('../../assets/team-scene/quest/figures/member-4.png'),
    require('../../assets/team-scene/quest/figures/member-5.png'),
    require('../../assets/team-scene/quest/figures/member-6.png'),
    require('../../assets/team-scene/quest/figures/member-7.png'),
    require('../../assets/team-scene/quest/figures/member-8.png')
  ]
}

const OFFICE: TeamSceneQuestArt = {
  backdrop: require('../../assets/team-scene/quest/office/backdrop.png'),
  front: null,
  lead: require('../../assets/team-scene/quest/office/lead.png'),
  advisor: require('../../assets/team-scene/quest/office/advisor.png'),
  members: [
    require('../../assets/team-scene/quest/office/member-1.png'),
    require('../../assets/team-scene/quest/office/member-2.png'),
    require('../../assets/team-scene/quest/office/member-3.png'),
    require('../../assets/team-scene/quest/office/member-4.png'),
    require('../../assets/team-scene/quest/office/member-5.png'),
    require('../../assets/team-scene/quest/office/member-6.png'),
    require('../../assets/team-scene/quest/office/member-7.png'),
    require('../../assets/team-scene/quest/office/member-8.png')
  ]
}

/** Orca's own Quest art for the band, which ships in the app rather than in a scene file. */
export const teamSceneQuestArtOf = (style: 'figures' | 'office'): TeamSceneQuestArt =>
  style === 'figures' ? FIGURES : OFFICE
