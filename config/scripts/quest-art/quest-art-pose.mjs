// The pose of one sheet frame, as plain numbers, so a test can hold the feet to the ground.

/** Half a stride in figure units; the engine's walk advances by this, so feet do not slide. */
export const FOOT_REACH = 4.4
export const THIGH = 6.2
export const SHIN = 6.2
const STEP_LIFT = 2.8
const TAU = 2 * Math.PI

/** Sheet rows: the seven actions the engine acts out. `fps` is absent where the engine steps it. */
export const QUEST_ACTIONS = {
  idle: { row: 0, frames: 4, fps: 4 },
  work: { row: 1, frames: 6, fps: 8 },
  walk: { row: 2, frames: 8 },
  raise: { row: 3, frames: 4, fps: 6 },
  give: { row: 4, frames: 4, fps: 6 },
  wave: { row: 5, frames: 4, fps: 6 },
  cheer: { row: 6, frames: 6, fps: 10 }
}

/** A foot against the hip: flat and sliding back for half the cycle, lifted forward for the rest. */
export function footAt(cycle) {
  const u = ((cycle % 1) + 1) % 1
  if (u < 0.5) {
    return { x: FOOT_REACH * (1 - 4 * u), y: 0 }
  }
  const k = (u - 0.5) * 2
  const eased = k * k * (3 - 2 * k)
  return { x: -FOOT_REACH + 2 * FOOT_REACH * eased, y: -Math.sin(k * Math.PI) * STEP_LIFT }
}

const wave = (k, hz = 1) => Math.sin(k * TAU * hz)

/**
 * `k` runs from 0 to 1 over the action. Arm angles are from straight down, forward positive; a
 * tool's `grip` is its own rotation from upright.
 */
export function poseAt(action, k, seated = false) {
  const base = {
    bob: wave(k) * 0.35,
    lean: 0,
    arm: 0.25 + wave(k) * 0.04,
    backArm: -0.2 - wave(k) * 0.04,
    grip: 0.5,
    legs: { near: { x: 2.2, y: 0 }, far: { x: -2.2, y: 0 } },
    sway: wave(k) * 0.5,
    seated: false,
    carry: false
  }
  if (action === 'walk') {
    return {
      ...base,
      bob: Math.abs(wave(k)) * 1.1,
      lean: 0.08,
      arm: Math.cos(k * TAU) * 0.6,
      backArm: -Math.cos(k * TAU) * 0.6,
      legs: { near: footAt(k + 0.5), far: footAt(k) },
      sway: wave(k) * 1.4
    }
  }
  if (action === 'work' && seated) {
    return {
      ...base,
      bob: 0,
      lean: 0.12,
      arm: 1.35 + wave(k, 3) * 0.08,
      backArm: 1.2 - wave(k, 3) * 0.08,
      seated: true
    }
  }
  if (action === 'work') {
    // Raised slowly over two thirds of the swing, then a fast drop to the work.
    const up = k < 0.66 ? k / 0.66 : (1 - k) / 0.34
    const arm = 0.7 + up * 1.9
    return { ...base, lean: 0.12 - up * 0.1, arm, grip: 1.7 - up * 1.9, backArm: 0.35 }
  }
  if (action === 'raise') {
    // Forward of the head, or the raised hand covers the face.
    const arm = 2.1 + wave(k) * 0.12
    return { ...base, arm, grip: 3.1 - arm, lean: -0.03 }
  }
  if (action === 'wave') {
    const arm = 2.2 + wave(k) * 0.28
    return { ...base, arm, grip: 3 - arm }
  }
  if (action === 'cheer') {
    const arm = 2.35 + wave(k) * 0.16
    return { ...base, arm, backArm: arm - 0.25, grip: 3 - arm, bob: wave(k) * 0.6, lean: -0.04 }
  }
  if (action === 'give') {
    return {
      ...base,
      arm: 1.5 + wave(k) * 0.05,
      backArm: 1.15,
      grip: 1.25,
      lean: 0.06,
      carry: true
    }
  }
  return base
}
