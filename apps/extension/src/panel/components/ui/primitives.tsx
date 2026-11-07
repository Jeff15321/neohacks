import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/** shadcn/ui-style Card, Badge, Input, Textarea (copied pattern, no Radix needed). */

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-lg border bg-card text-card-foreground shadow-xs', className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 p-3 pb-2', className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('m-0 flex items-center gap-2 text-[13.5px] font-semibold leading-tight', className)} {...p} />
);
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('m-0 text-xs text-muted-foreground', className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-3 pb-3', className)} {...p} />
);

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0 text-[10.5px] font-medium leading-5 whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-secondary text-secondary-foreground',
      accent: 'border-transparent bg-accent/15 text-accent',
      success: 'border-transparent bg-success/15 text-success',
      warning: 'border-transparent bg-warning/20 text-warning',
      destructive: 'border-transparent bg-destructive/15 text-destructive',
      outline: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});
export const Badge = ({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ variant }), className)} {...p} />
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn('h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn('flex min-h-16 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-2 text-[13px] outline-none field-sizing-content focus-visible:ring-2 focus-visible:ring-ring/40', className)} {...p} />
));
Textarea.displayName = 'Textarea';

/** Collapsible section (used for "View code", logs, Inspector panes). */
export function Disclosure({ title, defaultOpen = false, children, className, testId }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; className?: string; testId?: string }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn('rounded-md border', className)} data-testid={testId}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full cursor-pointer items-center gap-1.5 bg-transparent px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <span className={cn('inline-block transition-transform', open && 'rotate-90')}>▸</span>{title}
      </button>
      {open && <div className="border-t px-2.5 py-2">{children}</div>}
    </div>
  );
}

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{children}</div>
);
