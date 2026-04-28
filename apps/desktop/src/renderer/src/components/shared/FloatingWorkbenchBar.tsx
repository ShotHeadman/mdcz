import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FloatingWorkbenchBarProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function FloatingWorkbenchBar({ children, className, contentClassName }: FloatingWorkbenchBarProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-6 md:px-6 md:pb-8 lg:px-8",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-auto rounded-quiet-capsule bg-surface-floating/92 shadow-[0_20px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface-floating/84",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
