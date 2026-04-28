import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { quietCapsuleClass, quietFocusRingClass } from "./quietCraft";

const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
    quietCapsuleClass,
    quietFocusRingClass,
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/92",
        secondary: "border-border/50 bg-surface-raised text-foreground [a&]:hover:bg-surface-low",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/92",
        outline: "border-border/60 bg-surface-floating text-foreground [a&]:hover:bg-surface-low",
        ghost: "bg-transparent text-muted-foreground [a&]:hover:bg-surface-low [a&]:hover:text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
