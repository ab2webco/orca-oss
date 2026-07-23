import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Blocks, PlugZap, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type {
  GlobalConfigMcpEntry,
  GlobalConfigSyncInventory,
  PluginHookEntry
} from '../../../../shared/global-config-sync'

type GlobalConfigSyncDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // null/undefined = every managed account; a string targets one account.
  accountId?: string | null
  onSynced?: () => void
}

const MCP_SOURCE_LABELS: Record<GlobalConfigMcpEntry['source'], string> = {
  get 'user-config'() {
    return translate(
      'auto.components.settings.GlobalConfigSyncDialog.sourceUserConfig',
      '.claude.json'
    )
  },
  get settings() {
    return translate(
      'auto.components.settings.GlobalConfigSyncDialog.sourceSettings',
      'settings.json'
    )
  },
  get 'plugin-dir'() {
    return translate('auto.components.settings.GlobalConfigSyncDialog.sourcePluginDir', 'plugin')
  }
}

/** A one-line label for a hook: its event and the script it runs. */
function hookLabel(hook: PluginHookEntry): string {
  const script = hook.command.split(/[\\/]/).pop() ?? hook.command
  const suffix = hook.matcher ? ` (${hook.matcher})` : ''
  return `${hook.event}${suffix} → ${script}`
}

function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export function GlobalConfigSyncDialog({
  open,
  onOpenChange,
  accountId,
  onSynced
}: GlobalConfigSyncDialogProps): React.JSX.Element {
  const [inventory, setInventory] = useState<GlobalConfigSyncInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set())
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set())
  const [writeGlobalHooks, setWriteGlobalHooks] = useState(true)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLoading(true)
    setInventory(null)
    void window.api.claudeAccounts
      .previewGlobalConfig()
      .then((result) => {
        if (cancelled) {
          return
        }
        setInventory(result)
        // Default to selecting everything; the user opts things out.
        setSelectedMcp(new Set(result.mcpServers.map((entry) => entry.name)))
        setSelectedSkills(new Set(result.skills))
        setSelectedHooks(new Set(result.hooks.map((hook) => hook.id)))
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(
            translate(
              'auto.components.settings.GlobalConfigSyncDialog.previewFailed',
              'Could not read your global config.'
            )
          )
          onOpenChange(false)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, onOpenChange])

  const totalSelected = selectedMcp.size + selectedSkills.size + selectedHooks.size

  const handleSync = useCallback(async () => {
    const selection = {
      mcpServerNames: [...selectedMcp],
      skillNames: [...selectedSkills],
      hookIds: [...selectedHooks],
      writeGlobalHooks
    }
    setSubmitting(true)
    try {
      if (accountId) {
        await window.api.claudeAccounts.syncGlobalConfigForAccount({ accountId, selection })
        toast.success(
          translate(
            'auto.components.settings.GlobalConfigSyncDialog.syncedAccount',
            'Synced selected config into this account.'
          )
        )
      } else {
        const processed = await window.api.claudeAccounts.resyncGlobalConfig({ selection })
        toast.success(
          translate(
            'auto.components.settings.GlobalConfigSyncDialog.syncedAll',
            'Synced selected config into {{value0}} account(s).',
            { value0: String(processed) }
          )
        )
      }
      onSynced?.()
      onOpenChange(false)
    } catch {
      toast.error(
        translate(
          'auto.components.settings.GlobalConfigSyncDialog.syncFailed',
          'Failed to sync global config.'
        )
      )
    } finally {
      setSubmitting(false)
    }
  }, [
    accountId,
    onOpenChange,
    onSynced,
    selectedHooks,
    selectedMcp,
    selectedSkills,
    writeGlobalHooks
  ])

  const isEmpty = useMemo(
    () =>
      inventory !== null &&
      inventory.mcpServers.length === 0 &&
      inventory.skills.length === 0 &&
      inventory.hooks.length === 0,
    [inventory]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.GlobalConfigSyncDialog.title',
              'Choose what to sync'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.GlobalConfigSyncDialog.description',
              'Pick which global MCP servers, skills, and plugin hooks to copy into managed accounts. Unchecked items are left untouched.'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading || inventory === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate(
              'auto.components.settings.GlobalConfigSyncDialog.loading',
              'Reading config…'
            )}
          </div>
        ) : isEmpty ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {translate(
              'auto.components.settings.GlobalConfigSyncDialog.empty',
              'No global MCP servers, skills, or plugin hooks were found.'
            )}
          </div>
        ) : (
          <ScrollArea className="max-h-[360px] pr-3">
            <div className="flex flex-col gap-5">
              <ConfigSection
                icon={<PlugZap className="size-3.5" />}
                title={translate(
                  'auto.components.settings.GlobalConfigSyncDialog.mcpTitle',
                  'MCP servers'
                )}
                count={inventory.mcpServers.length}
                selectedCount={selectedMcp.size}
                onSelectAll={() =>
                  setSelectedMcp(new Set(inventory.mcpServers.map((entry) => entry.name)))
                }
                onSelectNone={() => setSelectedMcp(new Set())}
              >
                {inventory.mcpServers.map((entry) => (
                  <SelectableRow
                    key={entry.name}
                    checked={selectedMcp.has(entry.name)}
                    onToggle={() => setSelectedMcp((prev) => toggle(prev, entry.name))}
                    label={entry.name}
                    meta={MCP_SOURCE_LABELS[entry.source]}
                  />
                ))}
              </ConfigSection>

              <ConfigSection
                icon={<Blocks className="size-3.5" />}
                title={translate(
                  'auto.components.settings.GlobalConfigSyncDialog.skillsTitle',
                  'Skills'
                )}
                count={inventory.skills.length}
                selectedCount={selectedSkills.size}
                onSelectAll={() => setSelectedSkills(new Set(inventory.skills))}
                onSelectNone={() => setSelectedSkills(new Set())}
              >
                {inventory.skills.map((name) => (
                  <SelectableRow
                    key={name}
                    checked={selectedSkills.has(name)}
                    onToggle={() => setSelectedSkills((prev) => toggle(prev, name))}
                    label={name}
                  />
                ))}
              </ConfigSection>

              <ConfigSection
                icon={<Webhook className="size-3.5" />}
                title={translate(
                  'auto.components.settings.GlobalConfigSyncDialog.hooksTitle',
                  'Plugin hooks'
                )}
                count={inventory.hooks.length}
                selectedCount={selectedHooks.size}
                onSelectAll={() =>
                  setSelectedHooks(new Set(inventory.hooks.map((hook) => hook.id)))
                }
                onSelectNone={() => setSelectedHooks(new Set())}
              >
                {inventory.hooks.map((hook) => (
                  <SelectableRow
                    key={hook.id}
                    checked={selectedHooks.has(hook.id)}
                    onToggle={() => setSelectedHooks((prev) => toggle(prev, hook.id))}
                    label={hookLabel(hook)}
                    meta={hook.pluginName}
                  />
                ))}
              </ConfigSection>

              {inventory.hooks.length > 0 ? (
                <label className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={writeGlobalHooks}
                    onCheckedChange={(value) => setWriteGlobalHooks(value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    {translate(
                      'auto.components.settings.GlobalConfigSyncDialog.globalHooksToggle',
                      'Also write selected hooks to global ~/.claude/settings.json (for non-pinned sessions).'
                    )}
                  </span>
                </label>
              ) : null}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {translate('auto.components.settings.GlobalConfigSyncDialog.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() => void handleSync()}
            disabled={loading || submitting || totalSelected === 0}
            className="gap-1.5"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {translate('auto.components.settings.GlobalConfigSyncDialog.confirm', 'Sync selected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ConfigSectionProps = {
  icon: React.ReactNode
  title: string
  count: number
  selectedCount: number
  onSelectAll: () => void
  onSelectNone: () => void
  children: React.ReactNode
}

function ConfigSection({
  icon,
  title,
  count,
  selectedCount,
  onSelectAll,
  onSelectNone,
  children
}: ConfigSectionProps): React.JSX.Element | null {
  if (count === 0) {
    return null
  }
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {icon}
          {title}
          <span className="text-muted-foreground">
            ({selectedCount}/{count})
          </span>
        </span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onSelectAll}
          >
            {translate('auto.components.settings.GlobalConfigSyncDialog.selectAll', 'All')}
          </button>
          <span className="text-border">·</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onSelectNone}
          >
            {translate('auto.components.settings.GlobalConfigSyncDialog.selectNone', 'None')}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

type SelectableRowProps = {
  checked: boolean
  onToggle: () => void
  label: string
  meta?: string
}

function SelectableRow({ checked, onToggle, label, meta }: SelectableRowProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
        checked ? 'border-border bg-accent/40' : 'border-transparent hover:bg-muted/40'
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{label}</span>
      {meta ? <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span> : null}
    </label>
  )
}
