import { describe, expect, it } from 'vitest'
import type { LocalStreamWrite } from './transport'
import { createLocalStreamFrameWriter } from './local-stream-frame-writer'

function fakeSocket(outcomes: LocalStreamWrite[]) {
  const written: string[] = []
  const send = (frame: string): LocalStreamWrite => {
    const outcome = outcomes.shift() ?? 'written'
    if (outcome === 'written') {
      written.push(frame)
    }
    return outcome
  }
  return { send, written }
}

describe('createLocalStreamFrameWriter', () => {
  it('writes frames straight through while the reader keeps up', () => {
    const socket = fakeSocket([])
    const write = createLocalStreamFrameWriter(socket.send, (count) => `dropped:${count}`)
    write('a')
    write('b')
    expect(socket.written).toEqual(['a', 'b'])
  })

  it('tells a slow reader how many frames it lost before the next one it gets', () => {
    const socket = fakeSocket(['dropped', 'written', 'written'])
    const write = createLocalStreamFrameWriter(socket.send, (count) => `dropped:${count}`)
    write('a')
    write('b')
    expect(socket.written).toEqual(['dropped:1', 'b'])
  })

  it('keeps counting while the notice itself cannot be written', () => {
    const socket = fakeSocket(['dropped', 'dropped', 'dropped', 'written', 'written'])
    const write = createLocalStreamFrameWriter(socket.send, (count) => `dropped:${count}`)
    write('a')
    write('b')
    write('c')
    expect(socket.written).toEqual(['dropped:2', 'c'])
  })
})
