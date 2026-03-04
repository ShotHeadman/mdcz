import { Loader2 } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { useFormContext } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { Row } from "@/components/shared/Row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChipArrayField } from "./ChipArrayField";
import { DurationField } from "./DurationField";
import { ServerPathField } from "./ServerPathField";

// ── Centralized Base Field ──

interface BaseFieldProps {
  name: string;
  label: string;
  description?: string;
  children: (field: ControllerRenderProps<FieldValues, string>) => React.ReactNode;
  contentClassName?: string;
  fullWidthContent?: boolean;
}

/**
 * BaseField ensures consistent layout using Row and links FormField state.
 * Important: children must wrap the interactive element in <FormControl> to preserve Radix accessibility.
 */
export function BaseField({ name, label, description, children, contentClassName, fullWidthContent }: BaseFieldProps) {
  const form = useFormContext();
  return (
    <div className="hover:bg-muted/5 transition-colors group">
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem className="space-y-0">
            {fullWidthContent ? (
              <div className="flex flex-col">
                <Row variant="form" label={label} description={description} />
                <div className="px-4 pb-4">{children(field)}</div>
              </div>
            ) : (
              <Row variant="form" label={label} description={description} contentClassName={contentClassName}>
                {children(field)}
              </Row>
            )}
            <FormMessage className="px-4 pb-2 -mt-1" />
          </FormItem>
        )}
      />
    </div>
  );
}

// ── Boolean ──

export function BoolField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <FormControl>
          <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        </FormControl>
      )}
    </BaseField>
  );
}

// ── Text ──

export function TextField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <FormControl>
          <Input
            {...field}
            value={field.value ?? ""}
            className="h-8 w-[320px] text-sm bg-background/50 focus:bg-background transition-all"
          />
        </FormControl>
      )}
    </BaseField>
  );
}

// ── URL ──

export function UrlField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <FormControl>
          <Input
            {...field}
            value={field.value ?? ""}
            type="url"
            placeholder="https://..."
            className="h-8 w-[320px] text-sm bg-background/50 focus:bg-background transition-all"
          />
        </FormControl>
      )}
    </BaseField>
  );
}

// ── Number ──

export function NumberField({
  name,
  label,
  description,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <FormControl>
          <Input
            type="number"
            {...field}
            value={field.value ?? ""}
            onChange={(e) => field.onChange(Number(e.target.value))}
            min={min}
            max={max}
            step={step ?? 1}
            className="h-8 w-24 text-sm bg-background/50 focus:bg-background transition-all text-right"
          />
        </FormControl>
      )}
    </BaseField>
  );
}

// ── Enum (Select) ──

export type EnumOption = string | { value: string; label: string };

export function EnumField({
  name,
  label,
  description,
  options,
}: {
  name: string;
  label: string;
  description?: string;
  options: EnumOption[];
}) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <FormControl>
          <Select value={(field.value as string) ?? ""} onValueChange={field.onChange}>
            <SelectTrigger className="h-8 w-[320px] text-sm bg-background/50 focus:bg-background transition-all">
              <SelectValue placeholder="选择选项" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => {
                const value = typeof option === "string" ? option : option.value;
                const display = typeof option === "string" ? option : option.label;
                return (
                  <SelectItem key={value} value={value}>
                    {display}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </FormControl>
      )}
    </BaseField>
  );
}

// ── Cookie with validation ──

const COOKIE_VALIDATE_FIELDS = new Set(["network.javdbCookie", "network.javbusCookie"]);

function CookieValidateButton({ fieldKey }: { fieldKey: string }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; message: string } | null>(null);
  const siteName = fieldKey.includes("javdb") ? "JavDB" : "JavBus";

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const response = await ipc.network.checkCookies();
      const entry = response.results.find((r) => r.site === siteName);
      setResult(entry ?? { valid: false, message: "未找到验证结果" });
    } catch (error) {
      setResult({ valid: false, message: error instanceof Error ? error.message : "验证请求失败" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={handleCheck}
        disabled={checking}
      >
        {checking ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> 验证中...
          </>
        ) : (
          "验证 Cookie"
        )}
      </Button>
      {result && (
        <Badge variant={result.valid ? "default" : "destructive"} className="text-xs">
          {result.message}
        </Badge>
      )}
    </div>
  );
}

export function CookieFieldWrapper({
  name,
  label,
  description,
}: {
  name: string;
  label: string;
  description?: string;
}) {
  return (
    <BaseField name={name} label={label} description={description} fullWidthContent>
      {(field) => (
        <div className="flex flex-col gap-2">
          {COOKIE_VALIDATE_FIELDS.has(name) && (
            <div className="flex justify-end mb-1">
              <CookieValidateButton fieldKey={name} />
            </div>
          )}
          <FormControl>
            <Textarea
              {...field}
              value={field.value ?? ""}
              className="min-h-[80px] font-mono text-xs bg-background/50 focus:bg-background transition-all resize-none border-input/50"
            />
          </FormControl>
        </div>
      )}
    </BaseField>
  );
}

// ── Prompt (multi-line) ──

export function PromptFieldWrapper({
  name,
  label,
  description,
}: {
  name: string;
  label: string;
  description?: string;
}) {
  return (
    <BaseField name={name} label={label} description={description} fullWidthContent>
      {(field) => (
        <FormControl>
          <Textarea
            {...field}
            value={field.value ?? ""}
            className="min-h-[120px] text-sm bg-background/50 focus:bg-background transition-all border-input/50"
          />
        </FormControl>
      )}
    </BaseField>
  );
}

// ── Path ──

export function PathFieldWrapper({
  name,
  label,
  description,
  isDirectory,
}: {
  name: string;
  label: string;
  description?: string;
  isDirectory?: boolean;
}) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => (
        <div className="w-[450px]">
          <ServerPathField field={field} isDirectory={isDirectory} />
        </div>
      )}
    </BaseField>
  );
}

// ── Duration ──

export function DurationFieldWrapper({
  name,
  label,
  description,
}: {
  name: string;
  label: string;
  description?: string;
}) {
  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => <DurationField field={field} />}
    </BaseField>
  );
}

// ── ChipArray ──

export function ChipArrayFieldWrapper({
  name,
  label,
  description,
  options,
}: {
  name: string;
  label: string;
  description?: string;
  options?: string[];
}) {
  return (
    <BaseField name={name} label={label} description={description} fullWidthContent>
      {(field) => <ChipArrayField field={field} options={options} />}
    </BaseField>
  );
}

// ── Shortcut (kbd capture) ──

const MODIFIER_KEYS = new Set(["shift", "control", "ctrl", "meta", "alt"]);

const normalizeShortcutToken = (value: string): string => {
  const raw = value.trim();
  const token = raw.toLowerCase().replace(/\s+/gu, "");
  if (!token) {
    return "";
  }
  if (token === "mod") {
    return "Mod";
  }
  if (token === "ctrl") {
    return "Ctrl";
  }
  if (token === "meta") {
    return "Meta";
  }
  if (token === "alt") {
    return "Alt";
  }
  if (token === "shift") {
    return "Shift";
  }
  if (token === "space" || token === "spacebar") {
    return "Space";
  }
  if (token === "arrowleft") return "ArrowLeft";
  if (token === "arrowright") return "ArrowRight";
  if (token === "arrowup") return "ArrowUp";
  if (token === "arrowdown") return "ArrowDown";
  if (raw.length === 1) {
    return raw.toUpperCase();
  }
  return raw;
};

const shortcutParts = (value: unknown): string[] => {
  if (typeof value !== "string") {
    return [];
  }
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
  if (token.length === 1) return token.toUpperCase();
  return token;
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
    if (lowered === "arrowleft") return "ArrowLeft";
    if (lowered === "arrowright") return "ArrowRight";
    if (lowered === "arrowup") return "ArrowUp";
    if (lowered === "arrowdown") return "ArrowDown";
  }
  if (normalized.length === 1) return normalized.toUpperCase();
  return normalized;
};

const buildShortcutFromKeyboardEvent = (event: ReactKeyboardEvent<HTMLButtonElement>): string | null => {
  const key = keyToShortcutToken(event.key);
  if (!key) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("Mod");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
};

export function ShortcutField({ name, label, description }: { name: string; label: string; description?: string }) {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <BaseField name={name} label={label} description={description}>
      {(field) => {
        const tokens = shortcutParts(field.value);
        const keyedTokens = (() => {
          const counts = new Map<string, number>();
          return tokens.map((token) => {
            const next = (counts.get(token) ?? 0) + 1;
            counts.set(token, next);
            return { token, key: `${token}-${next}` };
          });
        })();
        return (
          <div className="flex items-center gap-2 w-[320px] justify-end">
            <div className="relative group flex-1">
              <FormControl>
                <button
                  type="button"
                  className={cn(
                    "h-8 w-full px-3 rounded-md border transition-all text-left flex items-center justify-between overflow-hidden",
                    isRecording
                      ? "border-primary ring-2 ring-primary/20 bg-primary/5 cursor-default"
                      : "border-input bg-background/50 hover:border-muted-foreground/50 cursor-pointer",
                  )}
                  onClick={() => !isRecording && setIsRecording(true)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setIsRecording(false);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!isRecording) return;
                    event.preventDefault();
                    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
                      if (event.key === "Backspace" || event.key === "Delete") {
                        field.onChange("");
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
                      field.onChange(next);
                      setIsRecording(false);
                    }
                  }}
                  title={isRecording ? "请直接按下组合键" : "点击进行修改"}
                >
                  <div className="flex flex-wrap items-center gap-1.5 flex-1 mr-2">
                    {isRecording ? (
                      <span className="text-xs font-medium text-primary animate-pulse flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        录制中...
                      </span>
                    ) : tokens.length > 0 ? (
                      keyedTokens.map(({ token, key }) => (
                        <kbd
                          key={key}
                          className="inline-flex items-center rounded border border-border/50 bg-muted/80 px-1.5 h-5 text-[11px] font-mono font-medium shadow-sm"
                        >
                          {displayShortcutToken(token)}
                        </kbd>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">未设置</span>
                    )}
                  </div>

                  {!isRecording && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        修改
                      </span>
                    </div>
                  )}
                </button>
              </FormControl>
              {isRecording && (
                <div className="absolute inset-0 pointer-events-none rounded-md border-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary)/0.2)]" />
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => {
                field.onChange("");
                setIsRecording(false);
              }}
            >
              清空
            </Button>
          </div>
        );
      }}
    </BaseField>
  );
}
