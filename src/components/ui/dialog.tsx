import * as DialogPrimitive from '@radix-ui/react-dialog';
import {cn} from '@/lib/cn';
import {copy} from '@/lib/copy';
import {Icons} from './icon';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-overlay" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[70] w-[min(92vw,560px)] max-h-[min(88vh,40rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-6 shadow-2xl',
          className,
        )}
      >
        <DialogPrimitive.Title className="pr-10 font-display text-2xl text-fg">{title}</DialogPrimitive.Title>
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={copy.a11y.close}
        >
          <Icons.close className="h-5 w-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  pending,
  confirmDisabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <DialogPrimitive.Description className="text-sm leading-6 text-fg-muted">{body}</DialogPrimitive.Description>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex h-11 items-center rounded-md px-4 text-sm text-fg-muted hover:bg-surface-2"
            >
              {copy.a11y.close}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
            className={cn(
              'inline-flex h-11 items-center rounded-md px-4 text-sm font-medium',
              danger ? 'bg-danger text-danger-fg' : 'bg-accent text-accent-fg',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
