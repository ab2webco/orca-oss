import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameHostCapacity } from '../types'
import { hostCapacityLinesOf } from './host-capacity'

/** One line per host under the Panel's counts, yellow while a host is short, busy or silent (ORCA-841). */
export function hostCapacityTextsOf(
  $: EngineInterface,
  e: RenderInput,
  hosts: readonly GameHostCapacity[],
  isTap: boolean
): RenderElement[] {
  const { Text } = $.ui.resolve(e)
  return hostCapacityLinesOf(hosts, isTap).map((line) => (
    <Text key={`host-${line.key}`} color={line.warn ? 'yellow' : 'gray'} wrap="wrap">
      {line.text}
    </Text>
  ))
}
