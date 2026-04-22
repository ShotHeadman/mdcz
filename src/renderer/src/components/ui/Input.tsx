import type * as React from "react";

import { cn } from "@/lib/utils";
import { quietControlRadiusClass, quietFieldSurfaceClass, quietFocusRingClass } from "./quietCraft";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 px-3.5 py-2 text-sm leading-5 transition-[background-color,border-color,color,box-shadow] outline-none selection:bg-primary/20 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        quietControlRadiusClass,
        quietFieldSurfaceClass,
        quietFocusRingClass,
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
