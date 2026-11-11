import {cva, type VariantProps} from 'class-variance-authority';
import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {cn} from '@/lib/cn';
import {Icons} from './icon';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 min-h-10 min-w-10',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent/90',
        secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border border-border',
        ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        danger: 'bg-danger text-danger-fg hover:bg-danger/90',
        outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-2',
      },
      size: {
        sm: 'h-10 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
      },
    },
    defaultVariants: {variant: 'primary', size: 'md'},
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {className, variant, size, pending, children, disabled, ...props},
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({variant, size}), className)}
      disabled={disabled || pending}
      {...props}
    >
      {pending ? <Icons.spinner className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
