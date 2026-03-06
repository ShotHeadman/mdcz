import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

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
        "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all",
        isActive
          ? "bg-card text-foreground shadow-sm ring-1 ring-border/10"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { TabButton };
