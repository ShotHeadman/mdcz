import { Button, cn } from "@mdcz/ui";
import { RotateCcw } from "lucide-react";
import { useT } from "../i18n";

interface ResetToDefaultButtonProps {
  label: string;
  onClick: () => void;
  className?: string;
}

export function ResetToDefaultButton({ label, onClick, className }: ResetToDefaultButtonProps) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={t.settings.resetToDefault.ariaLabel(label)}
      title={t.settings.resetToDefault.title}
      onClick={onClick}
      className={cn(
        "h-6 w-6 rounded-[var(--radius-quiet-capsule)] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/setting-row:opacity-100 group-focus-within/setting-row:opacity-100",
        className,
      )}
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  );
}
