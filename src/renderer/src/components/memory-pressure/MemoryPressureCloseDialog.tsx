import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

type MemoryPressureCloseDialogProps = {
  /** Display name of the terminal to close; null keeps the dialog shut. */
  targetTitle: string | null
  closing: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function MemoryPressureCloseDialog({
  targetTitle,
  closing,
  onCancel,
  onConfirm
}: MemoryPressureCloseDialogProps): React.JSX.Element {
  const blockWhileClosing = (event: Event): void => {
    if (closing) {
      event.preventDefault()
    }
  }
  return (
    <Dialog
      open={targetTitle !== null}
      onOpenChange={(next) => {
        if (!next && !closing) {
          onCancel()
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton={!closing}
        onPointerDownOutside={blockWhileClosing}
        onEscapeKeyDown={blockWhileClosing}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.memoryPressure.MemoryPressureCloseDialog.title',
              'Close {{value0}}?',
              { value0: targetTitle ?? '' }
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.memoryPressure.MemoryPressureCloseDialog.description',
              'This ends the terminal and everything running in it, including any agent session and the servers it started. Unsaved work in that terminal is lost.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={closing}>
            {translate('auto.components.memoryPressure.MemoryPressureCloseDialog.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={closing}>
            {closing ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {closing
              ? translate(
                  'auto.components.memoryPressure.MemoryPressureCloseDialog.closing',
                  'Closing…'
                )
              : translate(
                  'auto.components.memoryPressure.MemoryPressureCloseDialog.confirm',
                  'Close terminal'
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
