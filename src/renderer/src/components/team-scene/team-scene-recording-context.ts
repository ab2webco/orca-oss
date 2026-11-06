// Why: happy-dom has no 2D canvas, so painter tests assert on the calls a style makes.
export type RecordedCall = { name: string; args: unknown[]; fillStyle?: unknown }

export function recordingContext(): {
  g: CanvasRenderingContext2D
  calls: RecordedCall[]
  fills: () => unknown[]
} {
  const calls: RecordedCall[] = []
  const state: Record<string | symbol, unknown> = { fillStyle: '#000', canvas: { width: 0 } }
  const gradient = { addColorStop: () => {} }
  const g = new Proxy(state, {
    get(target, prop) {
      if (prop in target) {
        return target[prop]
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => gradient
      }
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 6 })
      }
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args, fillStyle: target.fillStyle })
      }
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
  const fills = (): unknown[] => calls.filter((c) => c.name === 'fill').map((c) => c.fillStyle)
  return { g, calls, fills }
}
