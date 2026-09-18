import { useAppStore } from '@/store'
import PluginPanel from '../right-sidebar/PluginPanel'

/** Full-page surface for a panel contributed with `surface: 'nav'`. The box is
 *  explicit because `PluginPanel` only fills the height it is handed. */
export default function PluginNavPage(): React.JSX.Element | null {
  const tabKey = useAppStore((s) => s.activePluginNavTabKey)
  if (!tabKey) {
    return null
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PluginPanel key={tabKey} tabKey={tabKey} />
    </div>
  )
}
