import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { quietCapsuleClass, quietFieldSurfaceClass, quietFocusRingClass } from "./quietCraft";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] outline-none active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer",
    quietCapsuleClass,
    quietFocusRingClass,
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_16px_32px_-20px_rgba(15,23,42,0.7)] hover:bg-primary/92",
        destructive:
          "bg-destructive text-white shadow-[0_16px_32px_-22px_rgba(220,38,38,0.6)] hover:bg-destructive/92 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline: "border border-border/60 bg-transparent text-foreground hover:bg-surface-low/70",
        secondary: `${quietFieldSurfaceClass} hover:bg-surface-raised`,
        ghost: "text-muted-foreground hover:bg-surface-low hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3.5",
        xs: "h-7 gap-1 px-2.5 text-[11px] has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3.5 has-[>svg]:px-3",
        lg: "h-11 px-6 text-[15px] has-[>svg]:px-4.5",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
