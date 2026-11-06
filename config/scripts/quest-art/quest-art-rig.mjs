// Draws one original Quest character in side profile, facing right, feet at the origin.
import { SHIN, THIGH, poseAt } from './quest-art-pose.mjs'

const TAU = 2 * Math.PI
const OUTLINE = 'rgb(24 18 30 / 0.55)'
const ARM = 10.6

export const shade = (hex, k) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)))
  )
  return `rgb(${c.join(' ')})`
}

function limb(g, points, width, color) {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const [style, grow] of [
    [OUTLINE, 1.1],
    [color, 0]
  ]) {
    g.strokeStyle = style
    g.lineWidth = width + grow
    g.beginPath()
    points.forEach(([x, y], at) => (at === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
    g.stroke()
  }
}

function fill(g, color, draw) {
  g.beginPath()
  draw()
  g.closePath()
  g.fillStyle = color
  g.fill()
  g.strokeStyle = OUTLINE
  g.lineWidth = 0.55
  g.stroke()
}

function leg(g, look, hip, foot, far) {
  const dx = foot.x - hip.x
  const dy = foot.y - hip.y
  const reach = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.01)
  const bend = Math.sqrt(Math.max(0, THIGH * THIGH - (reach * reach) / 4))
  const n = Math.hypot(dx, dy) || 1
  const knee = [hip.x + dx / 2 + (bend * dy) / n, hip.y + dy / 2 - (bend * dx) / n]
  const color = far ? shade(look.leg, 0.72) : look.leg
  limb(g, [[hip.x, hip.y], knee, [foot.x, foot.y - 1.6]], 4.2, color)
  const boot = far ? shade(look.boot, 0.75) : look.boot
  fill(g, boot, () => g.roundRect(foot.x - 2.6, foot.y - 3, 7.2, 3.2, 1.4))
}

function seatedLegs(g, look, hipY) {
  const color = look.leg
  limb(
    g,
    [
      [-1, hipY],
      [8, hipY + 0.6],
      [9, -1.6]
    ],
    4.2,
    color
  )
  fill(g, look.boot, () => g.roundRect(6.6, -3, 7.2, 3.2, 1.4))
}

function cape(g, look, top, sway) {
  if (!look.cape) {
    return
  }
  const paint = g.createLinearGradient(-8, top, -8, top + 22)
  paint.addColorStop(0, look.cape)
  paint.addColorStop(1, shade(look.cape, 0.62))
  fill(g, paint, () => {
    g.moveTo(-3, top)
    g.quadraticCurveTo(-11 - sway, top + 9, -10.5 - sway * 1.7, top + 19)
    g.quadraticCurveTo(-6, top + 21, -1, top + 18)
    g.lineTo(3, top + 2)
  })
}

function torso(g, look, top) {
  const paint = g.createLinearGradient(-7, top, 7, top + 18)
  paint.addColorStop(0, shade(look.body, 1.2))
  paint.addColorStop(1, shade(look.body, 0.66))
  if (look.robe) {
    fill(g, paint, () => {
      g.moveTo(-6, top + 2)
      g.quadraticCurveTo(0, top - 2, 6, top + 2)
      g.lineTo(9, -3)
      g.quadraticCurveTo(0, -0.5, -9.5, -3)
    })
  } else {
    fill(g, paint, () => g.roundRect(-6.6, top, 13.2, 18, 4.6))
  }
  if (look.apron) {
    fill(g, look.apron, () => g.roundRect(0.6, top + 5, 6.4, 15, 1.6))
  }
  g.fillStyle = look.trim
  g.fillRect(look.robe ? -7 : -6.6, top + 13.2, look.robe ? 14.4 : 13.2, 2)
  if (look.emblem) {
    g.beginPath()
    g.arc(2.6, top + 6.4, 2, 0, TAU)
    g.fillStyle = look.trim
    g.fill()
  }
}

function hair(g, look, y) {
  if (look.hair) {
    fill(g, look.hair, () => {
      g.arc(-0.8, y - 0.8, 7.9, Math.PI * 0.62, Math.PI * 1.86)
      g.quadraticCurveTo(3, y - 4.6, -2, y - 3)
      g.quadraticCurveTo(-3.4, y + 1, -4.6, y + (look.long ? 11 : 6))
    })
  }
}

function head(g, look, y, blink) {
  hair(g, look, y)
  fill(g, look.skin, () => {
    g.arc(0.6, y, 6.9, 0, TAU)
  })
  fill(g, look.skin, () => {
    g.moveTo(6.8, y - 1.4)
    g.quadraticCurveTo(9.4, y + 0.6, 6.6, y + 1.9)
  })
  g.fillStyle = shade(look.skin, 0.8)
  g.beginPath()
  g.arc(-1.4, y + 0.5, 1.5, 0, TAU)
  g.fill()
  g.fillStyle = '#1d1a22'
  g.beginPath()
  g.ellipse(4, y - 0.8, 1, blink ? 0.25 : 1.55, 0, 0, TAU)
  g.fill()
  g.fillStyle = shade(look.skin, 0.82)
  g.fillRect(3.2, y + 3, 3, 0.75)
  if (look.brow) {
    g.fillStyle = look.brow
    g.fillRect(2.6, y - 3.5, 3.6, 0.9)
  }
  if (look.beard) {
    fill(g, look.beard, () => {
      g.moveTo(-1.5, y + 2)
      g.quadraticCurveTo(0, y + 9, 3, y + 10)
      g.quadraticCurveTo(7.4, y + 7, 7.2, y + 2.2)
      g.quadraticCurveTo(3, y + 3.6, -1.5, y + 2)
    })
  }
  const front = look.hair && !look.hat ? look.hair : null
  if (front) {
    fill(g, front, () => {
      g.moveTo(-5.6, y - 3.4)
      g.quadraticCurveTo(0, y - 9.4, 7.2, y - 3.6)
      g.quadraticCurveTo(2, y - 5.2, -5.6, y - 3.4)
    })
  }
}

const HATS = {
  crown(g, look, y) {
    fill(g, look.trim, () => {
      ;[
        [-5.6, -5],
        [-6.8, -11],
        [-2.8, -7.6],
        [0.6, -12.6],
        [4, -7.6],
        [7.8, -11],
        [6.6, -5]
      ].forEach(([x, dy]) => g.lineTo(x, y + dy))
    })
    g.fillStyle = '#c03a3a'
    g.beginPath()
    g.arc(0.6, y - 6.4, 0.9, 0, TAU)
    g.fill()
  },
  helm(g, look, y) {
    const steel = g.createLinearGradient(-6, y - 8, 7, y + 3)
    steel.addColorStop(0, '#eef2f7')
    steel.addColorStop(1, '#7a8698')
    fill(g, steel, () => {
      g.arc(0.6, y - 0.6, 7.6, Math.PI, 0)
      g.lineTo(8, y + 0.4)
      g.lineTo(2.4, y + 0.4)
      g.lineTo(0.8, y + 5)
      g.lineTo(-7, y + 4.6)
    })
    fill(g, look.trim, () => {
      g.moveTo(-1, y - 8)
      g.quadraticCurveTo(-9, y - 15, -13, y - 5)
      g.quadraticCurveTo(-8, y - 9, -3, y - 6.6)
    })
  },
  hood(g, look, y) {
    fill(g, look.cape ?? look.body, () => {
      g.moveTo(-8.6, y + 6.4)
      g.quadraticCurveTo(-10, y - 6, -2, y - 9.4)
      g.quadraticCurveTo(7, y - 9.6, 8, y - 2.4)
      g.quadraticCurveTo(3, y - 5.4, -0.6, y - 1.6)
      g.quadraticCurveTo(-2, y + 3, -1.6, y + 6.8)
    })
  },
  band(g, look, y) {
    fill(g, look.trim, () => g.roundRect(-6.6, y - 5, 14, 2.5, 1))
    fill(g, look.trim, () => {
      g.moveTo(-6, y - 4.4)
      g.lineTo(-11, y - 1.4)
      g.lineTo(-7.6, y - 2)
      g.lineTo(-10, y + 2)
      g.lineTo(-6, y - 2.6)
    })
  },
  wizard(g, look, y) {
    fill(g, shade(look.body, 0.82), () => {
      g.moveTo(-10, y - 3.4)
      g.quadraticCurveTo(-3, y - 8, -2.6, y - 14)
      g.quadraticCurveTo(-4, y - 19, -9, y - 21)
      g.quadraticCurveTo(1, y - 19.4, 5.6, y - 7)
      g.quadraticCurveTo(9, y - 4.6, 11, y - 2.4)
      g.quadraticCurveTo(0, y - 5, -10, y - 3.4)
    })
    g.fillStyle = look.trim
    g.fillRect(-3.4, y - 7.4, 9, 1.5)
  },
  cap(g, look, y) {
    fill(g, look.cape ?? look.trim, () => {
      g.arc(0.2, y - 2, 7.6, Math.PI, 0)
      g.lineTo(11, y - 2)
      g.lineTo(-7.4, y - 1)
    })
    fill(g, look.trim, () => {
      g.moveTo(-2, y - 8)
      g.quadraticCurveTo(-8, y - 15, -9, y - 16)
      g.quadraticCurveTo(-3, y - 13, 1, y - 8.6)
    })
  },
  mini(g, look, y) {
    fill(g, '#f2c94c', () => {
      ;[
        [-3.6, -7.4],
        [-4.4, -11.4],
        [-1.4, -9.4],
        [0.6, -12.6],
        [2.6, -9.4],
        [5.6, -11.4],
        [4.8, -7.4]
      ].forEach(([x, dy]) => g.lineTo(x, y + dy))
    })
  }
}

const TOOLS = {
  sword(g, look) {
    fill(g, '#dfe6ee', () => {
      g.moveTo(-1.3, 0)
      g.lineTo(-1, -14.6)
      g.lineTo(0, -17.6)
      g.lineTo(1, -14.6)
      g.lineTo(1.3, 0)
    })
    fill(g, look.trim, () => g.rect(-3.3, -0.6, 6.6, 1.7))
  },
  hammer(g) {
    limb(
      g,
      [
        [0, 3],
        [0, -12]
      ],
      1.7,
      '#5b3d24'
    )
    fill(g, '#8a95a4', () => g.roundRect(-4.6, -16.6, 9.2, 6, 1))
  },
  staff(g, look) {
    limb(
      g,
      [
        [0, 9],
        [0, -19]
      ],
      1.6,
      '#6b4a2a'
    )
    fill(g, look.trim, () => g.arc(0, -21.4, 2.8, 0, TAU))
  },
  wand(g, look) {
    limb(
      g,
      [
        [0, 2],
        [0, -10]
      ],
      1.2,
      '#3b2a1e'
    )
    fill(g, look.trim, () => g.arc(0, -11.4, 1.7, 0, TAU))
  },
  bow(g) {
    g.strokeStyle = '#7a5230'
    g.lineWidth = 1.6
    g.beginPath()
    g.arc(-5, -5, 11, -0.95, 0.95)
    g.stroke()
    g.strokeStyle = 'rgb(240 240 230 / 0.8)'
    g.lineWidth = 0.5
    g.beginPath()
    g.moveTo(1.4, -14)
    g.lineTo(1.4, 4)
    g.stroke()
  },
  dagger(g, look) {
    fill(g, '#dfe6ee', () => {
      g.moveTo(-1, 0)
      g.lineTo(0, -9)
      g.lineTo(1, 0)
    })
    fill(g, look.trim, () => g.rect(-2.4, -0.4, 4.8, 1.4))
  },
  scroll(g) {
    fill(g, '#f4e6c0', () => g.roundRect(-2, -8, 4, 11, 1.6))
  }
}

function arm(g, look, shoulder, angle, sleeve, skin) {
  const hand = [shoulder[0] + Math.sin(angle) * ARM, shoulder[1] + Math.cos(angle) * ARM]
  limb(g, [shoulder, hand], 3.6, sleeve)
  fill(g, skin, () => g.arc(hand[0], hand[1], 1.9, 0, TAU))
  return hand
}

/** One character at `k` (0 to 1) through `action`; the caller places the feet. */
export function drawCharacter(g, look, action, k) {
  const pose = poseAt(action, k, look.seatedWork === true)
  const seatY = pose.seated ? 6.4 : 0
  const hipY = -12.2 - pose.bob + seatY
  const top = hipY - 15.6
  const blink = action === 'idle' && k >= 0.75
  if (pose.seated) {
    seatedLegs(g, look, hipY)
  } else if (!look.robe) {
    leg(g, look, { x: -1.6, y: hipY }, pose.legs.far, true)
    leg(g, look, { x: 1.6, y: hipY }, pose.legs.near, false)
  } else {
    fill(g, shade(look.boot, 0.75), () =>
      g.roundRect(pose.legs.far.x - 2.6, pose.legs.far.y - 3, 7, 3, 1.4)
    )
    fill(g, look.boot, () => g.roundRect(pose.legs.near.x - 2.6, pose.legs.near.y - 3, 7, 3, 1.4))
  }
  g.save()
  g.translate(0, seatY - pose.bob)
  g.rotate(pose.lean)
  g.translate(0, -seatY + pose.bob)
  arm(
    g,
    look,
    [-1.4, top + 3.2],
    pose.backArm,
    shade(look.sleeve ?? look.body, 0.7),
    shade(look.skin, 0.86)
  )
  cape(g, look, top + 1, pose.sway)
  torso(g, look, top)
  head(g, look, top - 6.4, blink)
  HATS[look.hat]?.(g, look, top - 6.4)
  const hand = [2.2 + Math.sin(pose.arm) * ARM, top + 3.4 + Math.cos(pose.arm) * ARM]
  if (look.tool && !pose.seated && !pose.carry) {
    g.save()
    g.translate(hand[0], hand[1])
    // A staff is held up, not swung: at full swing it would leave the frame.
    g.rotate(look.tool === 'staff' ? pose.grip * 0.3 : pose.grip)
    TOOLS[look.tool](g, look)
    g.restore()
  }
  arm(g, look, [2.2, top + 3.4], pose.arm, look.sleeve ?? look.body, look.skin)
  if (pose.carry) {
    g.save()
    g.translate(hand[0] + 2, hand[1] - 2)
    g.rotate(1.3)
    TOOLS.scroll(g)
    g.restore()
  }
  g.restore()
}
