"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "./cn";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn("flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px inline-flex h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-sm text-ink-2 transition-colors hover:text-ink",
        "data-[state=active]:border-ink data-[state=active]:font-medium data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}
