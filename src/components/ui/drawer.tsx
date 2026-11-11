import * as Dialog from '@radix-ui/react-dialog';
import {copy} from '@/lib/copy';
import {Icons} from './icon';

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,480px)] flex-col border-l border-border bg-surface-1 p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-display text-2xl">{title}</Dialog.Title>
            <Dialog.Close
              className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-surface-2"
              aria-label={copy.a11y.close}
            >
              <Icons.close className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="mt-6 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
