import { createContext } from 'react'

/** The lead's bubble line while the scene has no room for its bubble, so its card shows it (ORCA-1139). */
export const TeamSceneLeadLineContext = createContext<string | null>(null)
