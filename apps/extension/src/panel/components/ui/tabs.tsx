import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils.js';

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('inline-flex h-8 w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 text-muted-foreground', className)} {...p} />
);

export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn('inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)}
    {...p}
  />
);

export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('flex-1 outline-none', className)} {...p} />
);
