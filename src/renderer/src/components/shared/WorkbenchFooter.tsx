interface WorkbenchFooterProps {
  activeLabel?: string;
  currentPath?: string;
  statusText?: string;
}

export function WorkbenchFooter({ activeLabel, currentPath, statusText }: WorkbenchFooterProps) {
  return (
    <div className="flex items-center justify-between border-t bg-background px-8 py-3 text-xs font-medium text-muted-foreground">
      <div className="flex max-w-[70%] items-center gap-4 truncate">
        {activeLabel && (
          <div className="flex items-center gap-2 text-primary animate-pulse">
            <div className="h-1.5 w-1.5 rounded-full bg-current" />
            {activeLabel}
          </div>
        )}
        <span className="truncate opacity-70">{currentPath || ""}</span>
      </div>
      {statusText && <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">{statusText}</span>}
    </div>
  );
}
