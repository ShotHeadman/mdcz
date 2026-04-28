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
        "relative h-auto justify-start gap-3 rounded-none transition-all cursor-pointer",
        collapsed ? "h-10 w-10 justify-center rounded-lg p-0" : "px-5 py-2",
        isActive
          ? "bg-transparent text-foreground font-bold before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-foreground"
          : "text-muted-foreground hover:bg-transparent hover:text-foreground font-medium",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { NavButton };
