"use client";
import * as React from "react";
import { Slider as S } from "radix-ui";
import { cn } from "./cn";

export function Slider({ className, label, ...props }: React.ComponentProps<typeof S.Root> & { label: string }) {
  return (
    <S.Root className={cn("relative flex h-6 w-full touch-none select-none items-center", className)} {...props}>
      <S.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-2">
        <S.Range className="absolute h-full bg-accent" />
      </S.Track>
      <S.Thumb
        aria-label={label}
        className="block size-5 cursor-grab rounded-full border-2 border-accent bg-raised shadow-sm transition-transform active:scale-110 active:cursor-grabbing"
      />
    </S.Root>
  );
}
