import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { quietFocusRingClass } from "./quietCraft";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-[1.1rem] shrink-0 rounded-[0.55rem] border border-border/60 bg-surface-low text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-[background-color,border-color,box-shadow] outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary/15 data-[state=checked]:bg-primary dark:aria-invalid:ring-destructive/40",
        quietFocusRingClass,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
