import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface TreeButtonProps extends Omit<React.ComponentProps<typeof Button>, "variant" | "size"> {
  isSelected?: boolean;
}

function TreeButton({ isSelected, className, children, asChild, type, ...props }: TreeButtonProps) {
  return (
    <Button
      asChild={asChild}
      type={asChild ? undefined : (type ?? "button")}
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start gap-3 rounded-md p-2 text-left hover:bg-accent/50 transition-all cursor-pointer",
        isSelected && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export { TreeButton };
