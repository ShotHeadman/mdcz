import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { quietCapsuleClass } from "./quietCraft";

export interface TabButtonProps extends Omit<React.ComponentProps<typeof Button>, "variant" | "size"> {
  isActive?: boolean;
}

function TabButton({ isActive, className, children, asChild, type, ...props }: TabButtonProps) {
  return (
    <Button
      asChild={asChild}
      type={asChild ? undefined : (type ?? "button")}
      variant="ghost"
      className={cn(
        "shrink-0 whitespace-nowrap px-3 py-2 text-xs font-medium transition-[background-color,border-color,color,box-shadow]",
        quietCapsuleClass,
        isActive
          ? "border border-border/50 bg-surface-floating text-foreground shadow-[0_14px_24px_-20px_rgba(15,23,42,0.35)]"
          : "text-muted-foreground hover:bg-surface-low hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { TabButton };
