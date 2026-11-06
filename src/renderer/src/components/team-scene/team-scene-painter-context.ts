import { createContext } from 'react'
import type { TeamScenePainter } from './team-scene-painter'

/** The scene's painter, so card faces draw each character exactly as the scene does. */
export const TeamScenePainterContext = createContext<TeamScenePainter | null>(null)
