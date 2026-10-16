import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { openGameLink } from './fleet-sync'
import { gameStrings } from './game-strings'
import { gameConfig } from './quest-runtime'

/**
 * A link the terminal opens, or with `openLinks: system` a press that has Orca open it in the
 * system browser, where the person is signed in to GitHub, Jira and the rest.
 */
export function gameLinkOf(
  $: EngineInterface,
  e: RenderInput,
  args: { key: string; url: string; worktreeId: string; label: string },
  child: RenderElement
): RenderElement {
  const { Button, Link } = $.ui.resolve(e)
  if (gameConfig().openLinks !== 'system') {
    return (
      <Link key={args.key} href={args.url}>
        {child}
      </Link>
    )
  }
  const open = () =>
    void openGameLink($, args.url, args.worktreeId).then((isOpen) => {
      if (!isOpen) {
        $.ui.toast(gameStrings().text.couldNotOpenLink(args.label))
      }
    })
  return (
    <Button key={args.key} plain onPress={open}>
      {child}
    </Button>
  )
}
