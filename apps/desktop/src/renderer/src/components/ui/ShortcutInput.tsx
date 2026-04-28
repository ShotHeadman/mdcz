import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

const MODIFIER_KEYS = new Set(["shift", "control", "ctrl", "meta", "alt"]);

const normalizeShortcutToken = (value: string): string => {
  const raw = value.trim();
  const token = raw.toLowerCase().replace(/\s+/gu, "");
  if (!token) return "";
  if (token === "mod") return "Mod";
  if (token === "ctrl") return "Ctrl";
  if (token === "meta") return "Meta";
  if (token === "alt") return "Alt";
  if (token === "shift") return "Shift";
  if (token === "space") return "Space";
  if (token === "arrowleft") return "ArrowLeft";
  if (token === "arrowright") return "ArrowRight";
  if (token === "arrowup") return "ArrowUp";
  if (token === "arrowdown") return "ArrowDown";
  return raw.length === 1 ? raw.toUpperCase() : raw;
};

const shortcutParts = (value: string): string[] => {
  return value
    .split("+")
    .map((part) => normalizeShortcutToken(part))
    .filter((part) => part.length > 0);
};

const displayShortcutToken = (token: string): string => {
  if (token === "Mod") return "⌘/Ctrl";
  if (token === "Ctrl") return "Ctrl";
  if (token === "Meta") return "⌘";
  if (token === "Alt") return "⌥";
  if (token === "Shift") return "⇧";
  if (token === "ArrowLeft") return "←";
  if (token === "ArrowRight") return "→";
  if (token === "ArrowUp") return "↑";
  if (token === "ArrowDown") return "↓";
  if (token === "Space") return "Space";
  return token.length === 1 ? token.toUpperCase() : token;
};

const keyToShortcutToken = (key: string): string | null => {
  const normalized = key.trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (MODIFIER_KEYS.has(lowered)) return null;
  if (lowered === " ") return "Space";
  if (lowered === "escape") return "Escape";
  if (lowered === "enter") return "Enter";
  if (lowered === "tab") return "Tab";
  if (lowered === "backspace") return "Backspace";
  if (lowered === "delete") return "Delete";
  if (lowered.startsWith("arrow")) {
    const map: Record<string, string> = {
      arrowleft: "ArrowLeft",
      arrowright: "ArrowRight",
      arrowup: "ArrowUp",
      arrowdown: "ArrowDown",
    };
    return map[lowered] || null;
  }
  return normalized.length === 1 ? normalized.toUpperCase() : normalized;
};

interface ShortcutInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function ShortcutInput({ value, onChange, className, disabled, ref }: ShortcutInputProps) {
  const [isRecording, setIsRecording] = React.useState(false);

  const tokens = React.useMemo(() => shortcutParts(value), [value]);
  const displayTokens = React.useMemo(() => {
    const tokenCounts = new Map<string, number>();

    return tokens.map((token) => {
      const count = (tokenCounts.get(token) ?? 0) + 1;
      tokenCounts.set(token, count);
      return {
        token,
        key: count === 1 ? token : `${token}-${count}`,
      };
    });
  }, [tokens]);

  const buildShortcutFromKeyboardEvent = (event: React.KeyboardEvent): string | null => {
    const key = keyToShortcutToken(event.key);
    if (!key) return null;
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push("Mod");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(key);
    return parts.join("+");
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "h-8 flex-1 px-3 rounded-md border transition-all text-left flex items-center justify-between overflow-hidden group",
          isRecording
            ? "border-primary ring-2 ring-primary/20 bg-primary/5 cursor-default"
            : "border-input bg-background/50 hover:border-muted-foreground/50 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        onClick={() => !isRecording && setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        onKeyDown={(event) => {
          if (!isRecording) return;
          event.preventDefault();

          if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            if (event.key === "Backspace" || event.key === "Delete") {
              onChange("");
              setIsRecording(false);
              return;
            }
            if (event.key === "Escape") {
              setIsRecording(false);
              return;
            }
          }

          const next = buildShortcutFromKeyboardEvent(event);
          if (next) {
            onChange(next);
            setIsRecording(false);
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 flex-1 mr-2">
          {isRecording ? (
            <span className="text-xs font-medium text-primary animate-pulse flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" />
              录制中...
            </span>
          ) : tokens.length > 0 ? (
            displayTokens.map((item) => (
              <kbd
                key={item.key}
                className="inline-flex items-center rounded border border-border/50 bg-muted/80 px-1.5 h-5 text-[11px] font-mono font-medium shadow-sm"
              >
                {displayShortcutToken(item.token)}
              </kbd>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">未设置</span>
          )}
        </div>
        {!isRecording && !disabled && (
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            修改
          </span>
        )}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onChange("");
          setIsRecording(false);
        }}
        disabled={disabled || !value}
      >
        清空
      </Button>
    </div>
  );
}

ShortcutInput.displayName = "ShortcutInput";
