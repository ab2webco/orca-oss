// Why the 2D Office's heights: the owner found the 3D one took more of the panel than it did.
const ART = 176
const FLOOR = 112
const FLOORS_SHOWN = 3

export const OFFICE3D_HEIGHT_KEY = 'orca.teamOffice3d.height'

/** The height the 3D Office opens at: one machine's stage, or three floors' strips at most. */
export const office3dDefaultHeight = (machines: number): number =>
  machines > 1 ? FLOOR * Math.min(FLOORS_SHOWN, machines) : ART
