import {forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes} from 'react';
import {cn} from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({className, ...props}, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-11 w-full rounded-md border border-border bg-bg-sunken px-3 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({className, ...props}, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-28 w-full rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm" htmlFor={htmlFor}>
      <span className="font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </label>
  );
}
