import PluginPanel from '../right-sidebar/PluginPanel'

/** Panels a plugin declares with `surface: 'settings'`, rendered inside its
 *  Settings card instead of the per-worktree right sidebar. They need an
 *  explicit box: `PluginPanel` fills the height it is given, and the card's
 *  auto-height flow would collapse it to nothing. */
export function PluginSettingsSurfacePanels({
  tabKeys
}: {
  tabKeys: readonly string[]
}): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {tabKeys.map((tabKey) => (
        <div
          key={tabKey}
          className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border bg-muted/40"
        >
          <PluginPanel tabKey={tabKey} />
        </div>
      ))}
    </div>
  )
}
