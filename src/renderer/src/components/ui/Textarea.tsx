import * as React from "react";

import { cn } from "@/lib/utils";

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
        "flex min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
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
