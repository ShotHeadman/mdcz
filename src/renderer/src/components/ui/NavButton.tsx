import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface NavButtonProps extends Omit<React.ComponentProps<typeof Button>, "variant" | "size"> {
  isActive?: boolean;
  collapsed?: boolean;
}

function NavButton({ isActive, collapsed, className, children, asChild, type, ...props }: NavButtonProps) {
  return (
    <Button
      asChild={asChild}
      type={asChild ? undefined : (type ?? "button")}
      variant="ghost"
      className={cn(
        "h-auto justify-start gap-3 rounded-lg transition-all cursor-pointer",
        collapsed ? "h-10 w-10 p-0 justify-center" : "px-3 py-2",
        isActive
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground font-normal",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { NavButton };
