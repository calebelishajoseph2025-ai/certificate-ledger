import {Toaster as Sonner, toast} from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'instrument bg-surface-1 text-fg border-border',
          description: 'text-fg-muted',
        },
      }}
    />
  );
}

export {toast};
