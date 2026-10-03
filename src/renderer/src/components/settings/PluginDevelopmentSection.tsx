import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

export type PluginDevelopmentFolders = {
  paths: string[]
  /** Subset of `paths` whose content edits keep the plugin approved. */
  trustedPaths: string[]
}

type PluginDevelopmentSectionProps = {
  paths: readonly string[]
  trustedPaths: readonly string[]
  busy: boolean
  onChange: (folders: PluginDevelopmentFolders) => Promise<void>
}

function saveErrorMessage(cause: unknown): string {
  console.warn('[plugins] development path update failed:', cause)
  return translate(
    'auto.components.settings.PluginDevelopmentSection.saveFailed',
    'Could not save development plugin paths.'
  )
}

export function PluginDevelopmentSection({
  paths,
  trustedPaths,
  busy,
  onChange
}: PluginDevelopmentSectionProps): React.JSX.Element {
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const trustLabel = translate(
    'auto.components.settings.PluginDevelopmentSection.trustLabel',
    'Trust changes in this folder'
  )

  const save = async (next: PluginDevelopmentFolders): Promise<boolean> => {
    setError(null)
    try {
      // Main loads each folder once, so a repeat add is a no-op rather than a second row.
      const paths = [...new Set(next.paths)]
      await onChange({
        paths,
        trustedPaths: [...new Set(next.trustedPaths)].filter((path) => paths.includes(path))
      })
      return true
    } catch (cause) {
      setError(saveErrorMessage(cause))
      return false
    }
  }

  const addPath = async (): Promise<void> => {
    const path = pathInput.trim()
    if (!path) {
      setError(
        translate(
          'auto.components.settings.PluginDevelopmentSection.pathRequired',
          'Enter a plugin folder path.'
        )
      )
      return
    }
    if (await save({ paths: [...paths, path], trustedPaths: [...trustedPaths] })) {
      setPathInput('')
    }
  }

  const removePath = async (index: number): Promise<void> => {
    await save({
      paths: paths.filter((_, pathIndex) => pathIndex !== index),
      trustedPaths: [...trustedPaths]
    })
  }

  const setTrusted = async (path: string, trusted: boolean): Promise<void> => {
    await save({
      paths: [...paths],
      trustedPaths: trusted
        ? [...trustedPaths, path]
        : trustedPaths.filter((trustedPath) => trustedPath !== path)
    })
  }

  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1.5 pr-2 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        {translate('auto.components.settings.PluginDevelopmentSection.title', 'Development')}
      </summary>
      <div className="space-y-3 pb-1 pl-5 pt-1">
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.settings.PluginDevelopmentSection.help',
            'Load plugins directly from folders on this computer while you develop them. Dev plugins still require permission review. Workers run on this desktop host; SSH workspace actions route through Orca Lab, so paths here are desktop paths.'
          )}
        </p>
        {paths.map((path, index) => (
          <div key={path} className="space-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-xs"
                title={path}
              >
                {path}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => void removePath(index)}
              >
                {translate('auto.components.settings.PluginDevelopmentSection.remove', 'Remove')}
              </Button>
            </div>
            <label className="flex w-fit max-w-2xl cursor-pointer items-start gap-2 pl-0.5 text-xs">
              <Checkbox
                className="mt-0.5"
                checked={trustedPaths.includes(path)}
                disabled={busy}
                aria-label={`${trustLabel}: ${path}`}
                onCheckedChange={(checked) => void setTrusted(path, checked === true)}
              />
              <span className="space-y-0.5">
                <span className="block font-medium text-foreground">{trustLabel}</span>
                <span className="block leading-5 text-muted-foreground">
                  {translate(
                    'auto.components.settings.PluginDevelopmentSection.trustHelp',
                    'Edits to files here keep the plugin approved and its worker running. New permissions still need your review.'
                  )}
                </span>
              </span>
            </label>
          </div>
        ))}
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void addPath()
          }}
        >
          <Label htmlFor="plugin-development-path" className="sr-only">
            {translate(
              'auto.components.settings.PluginDevelopmentSection.pathLabel',
              'Development plugin folder path'
            )}
          </Label>
          <Input
            id="plugin-development-path"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            className="h-8 min-w-0 font-mono text-xs"
            placeholder={translate(
              'auto.components.settings.PluginDevelopmentSection.placeholder',
              '/Users/you/plugins/my-plugin or C:\\Users\\you\\plugins\\my-plugin'
            )}
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'plugin-development-path-error' : undefined}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.settings.PluginDevelopmentSection.add', 'Add path')}
          </Button>
        </form>
        {error ? (
          <p id="plugin-development-path-error" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  )
}
