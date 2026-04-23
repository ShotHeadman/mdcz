import { Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { useFormContext } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { AutoSaveStatusIndicator } from "@/components/settings/AutoSaveStatusIndicator";
import { ResetToDefaultButton } from "@/components/settings/ResetToDefaultButton";
import { SettingRow } from "@/components/settings/SettingRow";
import { useOptionalSettingsSearch } from "@/components/settings/SettingsSearchContext";
import {
  shouldRenderFieldInSectionMode,
  useSettingsSectionMode,
} from "@/components/settings/SettingsSectionModeContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormControl, FormField, FormItem } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { ShortcutInput } from "@/components/ui/ShortcutInput";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { useAutoSaveField } from "@/hooks/useAutoSaveField";
import { ChipArrayField } from "./ChipArrayField";
import { DurationField } from "./DurationField";
import { OrderedSiteField } from "./OrderedSiteField";
import { ServerPathField } from "./ServerPathField";

// ── Centralized Base Field ──

type CommitMode = "debounce" | "immediate";

interface BaseFieldProps {
  name: string;
  label: string;
  description?: string;
  children: (field: ControllerRenderProps<FieldValues, string>) => React.ReactNode;
  fullWidthContent?: boolean;
  /**
   * When the user edits this field, should the save fire after a debounce
   * (free-text) or immediately (discrete controls like Switch/Select/pickers)?
   * Defaults to "immediate".
   */
  commitMode?: CommitMode;
}

/**
 * BaseField wires each form field to auto-save and renders it as a
 * `SettingRow` with the micro-status indicator in the right-aligned status
 * slot.
 */
export function BaseField({
  name,
  label,
  description,
  children,
  fullWidthContent,
  commitMode = "immediate",
}: BaseFieldProps) {
  const sectionMode = useSettingsSectionMode();

  if (!shouldRenderFieldInSectionMode(name, sectionMode)) {
    return null;
  }

  return (
    <ConnectedBaseField
      name={name}
      label={label}
      description={description}
      fullWidthContent={fullWidthContent}
      commitMode={commitMode}
    >
      {children}
    </ConnectedBaseField>
  );
}

function ConnectedBaseField({ name, label, description, children, fullWidthContent, commitMode }: BaseFieldProps) {
  const form = useFormContext();
  const { status, resetToDefault } = useAutoSaveField(name, { mode: commitMode, label });
  const search = useOptionalSettingsSearch();
  const visible = search ? search.isFieldVisible(name) : true;
  const highlighted = search ? search.isFieldHighlighted(name) : false;
  const modified = search ? search.isFieldModified(name) : false;

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }): ReactElement => {
        if (!visible) {
          return <FormItem className="hidden" aria-hidden="true" />;
        }

        const rowError =
          fieldState.error && typeof fieldState.error.message === "string" ? fieldState.error.message : null;

        return (
          <FormItem className="block space-y-0">
            <SettingRow
              fieldName={name}
              label={label}
              description={description}
              error={rowError}
              headerAction={modified ? <ResetToDefaultButton label={label} onClick={resetToDefault} /> : null}
              status={<AutoSaveStatusIndicator status={status} />}
              control={children(field)}
              fullWidthContent={fullWidthContent}
              highlighted={highlighted}
            />
          </FormItem>
        );
      }}
    />
  );
}

// ── Boolean ──

export function BoolField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description} commitMode="immediate">
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
    <BaseField name={name} label={label} description={description} commitMode="debounce">
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

export function SecretField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description} commitMode="debounce">
      {(field) => (
        <FormControl>
          <PasswordInput
            {...field}
            value={field.value ?? ""}
            autoComplete="off"
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
    <BaseField name={name} label={label} description={description} commitMode="debounce">
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
    <BaseField name={name} label={label} description={description} commitMode="debounce">
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
    <BaseField name={name} label={label} description={description} commitMode="immediate">
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
    <BaseField name={name} label={label} description={description} fullWidthContent commitMode="debounce">
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
              autoSize={false}
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
    <BaseField name={name} label={label} description={description} fullWidthContent commitMode="debounce">
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
    <BaseField name={name} label={label} description={description} commitMode="immediate">
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
    <BaseField name={name} label={label} description={description} commitMode="debounce">
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
  showBulkActions,
}: {
  name: string;
  label: string;
  description?: string;
  options?: string[];
  showBulkActions?: boolean;
}) {
  return (
    <BaseField name={name} label={label} description={description} fullWidthContent commitMode="immediate">
      {(field) => <ChipArrayField field={field} options={options} showBulkActions={showBulkActions} />}
    </BaseField>
  );
}

export function OrderedSiteFieldWrapper({
  name,
  label,
  description,
  options,
}: {
  name: string;
  label: string;
  description?: string;
  options: string[];
}) {
  return (
    <BaseField name={name} label={label} description={description} fullWidthContent commitMode="immediate">
      {(field) => <OrderedSiteField field={field} options={options} />}
    </BaseField>
  );
}

// ── Shortcut ──

export function ShortcutField({ name, label, description }: { name: string; label: string; description?: string }) {
  return (
    <BaseField name={name} label={label} description={description} commitMode="immediate">
      {(field) => (
        <FormControl>
          <ShortcutInput value={field.value as string} onChange={field.onChange} className="w-[320px] justify-end" />
        </FormControl>
      )}
    </BaseField>
  );
}
