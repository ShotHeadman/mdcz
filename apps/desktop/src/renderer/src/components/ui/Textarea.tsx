import * as React from "react";

import { cn } from "@/lib/utils";
import { quietControlRadiusClass, quietFieldSurfaceClass, quietFocusRingClass } from "./quietCraft";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  autoSize?: boolean;
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function Textarea({ className, autoSize = true, onInput, value, defaultValue, ...props }: TextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const renderedValue = value ?? defaultValue;

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    if (!autoSize) {
      textarea.style.height = "";
      return;
    }

    // Re-sync height when the rendered value changes outside the input event path.
    void renderedValue;
    resizeTextarea(textarea);
  }, [autoSize, renderedValue]);

  return (
    <textarea
      ref={textareaRef}
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full min-w-0 px-3.5 py-3 text-sm leading-6 transition-[background-color,border-color,color,box-shadow] outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        quietControlRadiusClass,
        quietFieldSurfaceClass,
        quietFocusRingClass,
        autoSize && "overflow-y-hidden",
        className,
      )}
      onInput={(event) => {
        if (autoSize) {
          resizeTextarea(event.currentTarget);
        }
        onInput?.(event);
      }}
      defaultValue={defaultValue}
      value={value}
      {...props}
    />
  );
}

export { Textarea };
