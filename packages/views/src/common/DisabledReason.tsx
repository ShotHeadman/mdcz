import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@mdcz/ui";
import type { ReactNode } from "react";

/**
 * Says why the controls inside are disabled. Disabled controls take no pointer or focus events, so the tooltip sits on
 * a wrapper, which takes focus only while there is a reason to read.
 */
export function DisabledReason({
  reason,
  className,
  children,
}: {
  reason?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={className} tabIndex={reason ? 0 : undefined}>
            {children}
          </span>
        </TooltipTrigger>
        {reason ? <TooltipContent>{reason}</TooltipContent> : null}
      </Tooltip>
    </TooltipProvider>
  );
}
