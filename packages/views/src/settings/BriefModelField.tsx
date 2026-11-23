import {
  type LlmConnectionSettings,
  type LlmSettings,
  llmConnectionSchema,
  resolveBriefLlmSettings,
} from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import {
  DEFAULT_LLM_BASE_URL,
  LLM_API_FORMAT_OPTIONS,
  LLM_OUTPUT_FORMAT_OPTIONS,
  LLM_SERVICE_TYPE_OPTIONS,
} from "@mdcz/shared/llm";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@mdcz/ui";
import { ChevronRight, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { type FieldValues, useFormContext } from "react-hook-form";
import { BaseField } from "../config-form/FieldRenderer";
import { useT } from "../i18n";
import { useSettingsServices } from "./SettingsServices";

interface BriefModelDraft {
  serviceType: LlmConnectionSettings["serviceType"];
  baseUrl: string;
  apiKey: string;
  modelName: string;
  apiFormat: LlmConnectionSettings["apiFormat"];
  reasoning: LlmConnectionSettings["reasoning"];
  outputFormat: LlmConnectionSettings["outputFormat"];
  temperature: string;
  timeout: string;
  maxRetries: string;
  maxRequestsPerSecond: string;
}

const toDraft = (connection: LlmConnectionSettings): BriefModelDraft => ({
  serviceType: connection.serviceType,
  baseUrl: connection.baseUrl,
  apiKey: connection.apiKey,
  modelName: connection.modelName,
  apiFormat: connection.apiFormat,
  reasoning: connection.reasoning,
  outputFormat: connection.outputFormat,
  temperature: connection.temperature === null ? "" : String(connection.temperature),
  timeout: String(connection.timeout),
  maxRetries: String(connection.maxRetries),
  maxRequestsPerSecond: String(connection.maxRequestsPerSecond),
});

const parseDraft = (draft: BriefModelDraft) => {
  const temperature = draft.temperature.trim() === "" ? null : Number(draft.temperature);
  return llmConnectionSchema.safeParse({
    serviceType: draft.serviceType,
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey,
    modelName: draft.modelName.trim(),
    apiFormat: draft.apiFormat,
    reasoning: draft.reasoning,
    outputFormat:
      draft.serviceType === "deepseek" && draft.outputFormat === "json_schema" ? "json_object" : draft.outputFormat,
    temperature,
    timeout: Number(draft.timeout),
    maxRetries: Number(draft.maxRetries),
    maxRequestsPerSecond: Number(draft.maxRequestsPerSecond),
  });
};

export function BriefModelField() {
  const t = useT();
  const form = useFormContext<FieldValues>();
  const [open, setOpen] = useState(false);

  return (
    <BaseField name="llm.briefModel" commitMode="immediate">
      {(field) => {
        const saved = (field.value as LlmConnectionSettings | null | undefined) ?? null;
        const dedicatedName = saved?.modelName.trim();
        return (
          <div className="flex items-center gap-3">
            {dedicatedName ? <span className="text-xs text-muted-foreground">{dedicatedName}</span> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t.settings.briefModel.configure}
            </Button>
            {open ? (
              <BriefModelDialog
                saved={saved}
                defaultConnection={resolveBriefLlmSettings({
                  ...(form.getValues("llm") as LlmSettings),
                  briefModel: null,
                })}
                onSave={(next) => {
                  field.onChange(next);
                  setOpen(false);
                }}
                onClose={() => setOpen(false)}
              />
            ) : null}
          </div>
        );
      }}
    </BaseField>
  );
}

function BriefModelDialog({
  saved,
  defaultConnection,
  onSave,
  onClose,
}: {
  saved: LlmConnectionSettings | null;
  defaultConnection: LlmConnectionSettings;
  onSave: (next: LlmConnectionSettings | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const text = t.settings.briefModel;
  const fields = t.settingsFields.fields;
  const services = useSettingsServices();
  const id = useId();
  const [useDedicated, setUseDedicated] = useState(saved !== null);
  const [draft, setDraft] = useState<BriefModelDraft>(() => toDraft(saved ?? llmConnectionSchema.parse({})));
  const [moreOpen, setMoreOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const edit = (patch: Partial<BriefModelDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const reasoningOptions = Object.entries(
    draft.serviceType === "deepseek" ? t.settings.options.llmReasoningDeepseek : t.settings.options.llmReasoning,
  ) as Array<[LlmConnectionSettings["reasoning"], string]>;
  const outputFormatOptions = LLM_OUTPUT_FORMAT_OPTIONS.filter(
    (option) => draft.serviceType !== "deepseek" || option !== "json_schema",
  );

  const resolveNext = (): { ok: true; value: LlmConnectionSettings | null } | { ok: false } => {
    if (!useDedicated) return { ok: true, value: null };
    const parsed = parseDraft(draft);
    if (!parsed.success) {
      setFeedback({ ok: false, text: text.invalidConfig });
      return { ok: false };
    }
    return { ok: true, value: parsed.data };
  };

  const handleVerify = async () => {
    setFeedback(null);
    const resolved = resolveNext();
    if (!resolved.ok) return;
    setTesting(true);
    try {
      const result = await services.checkBrief(resolved.value ?? defaultConnection);
      if (result.status === "ok") setFeedback({ ok: true, text: text.verified });
      else setFeedback({ ok: false, text: t.brief.check.failed[result.status](result.error ?? "") });
    } catch (reason) {
      setFeedback({ ok: false, text: t.brief.check.failed.failed(toErrorMessage(reason)) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    setFeedback(null);
    const resolved = resolveNext();
    if (!resolved.ok) return;
    onSave(resolved.value);
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && !testing && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle>{text.dialogTitle}</DialogTitle>
          <DialogDescription className="text-sm leading-6">{text.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-quiet-lg bg-surface-low px-4 py-3">
            <Label htmlFor={`${id}-dedicated`} className="text-sm font-medium">
              {text.useDedicated}
            </Label>
            <Switch
              id={`${id}-dedicated`}
              checked={useDedicated}
              onCheckedChange={(checked) => {
                setUseDedicated(checked);
                setFeedback(null);
              }}
            />
          </div>

          {!useDedicated ? (
            <p className="text-xs leading-5 text-muted-foreground">{text.useDedicatedHint}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-service`}>{fields["llm.serviceType"].label}</Label>
                <Select
                  value={draft.serviceType}
                  onValueChange={(value) => {
                    const serviceType = value as LlmConnectionSettings["serviceType"];
                    const nextReasoningLabels =
                      serviceType === "deepseek"
                        ? t.settings.options.llmReasoningDeepseek
                        : t.settings.options.llmReasoning;
                    edit({
                      serviceType,
                      ...(draft.reasoning in nextReasoningLabels ? {} : { reasoning: "default" }),
                      ...(serviceType === "deepseek" && draft.outputFormat === "json_schema"
                        ? { outputFormat: "json_object" }
                        : {}),
                    });
                  }}
                >
                  <SelectTrigger id={`${id}-service`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_SERVICE_TYPE_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t.settings.options.llmServiceType[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-url`}>{fields["llm.baseUrl"].label}</Label>
                <Input
                  id={`${id}-url`}
                  value={draft.baseUrl}
                  placeholder={DEFAULT_LLM_BASE_URL}
                  onChange={(event) => edit({ baseUrl: event.target.value })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-key`}>{fields["llm.apiKey"].label}</Label>
                <PasswordInput
                  id={`${id}-key`}
                  visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
                  value={draft.apiKey}
                  onChange={(event) => edit({ apiKey: event.target.value })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-model`}>{fields["llm.modelName"].label}</Label>
                <Input
                  id={`${id}-model`}
                  value={draft.modelName}
                  placeholder={text.modelPlaceholder}
                  onChange={(event) => edit({ modelName: event.target.value })}
                />
              </div>

              <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="pt-1">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", moreOpen && "rotate-90")} />
                    {text.moreOptions}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3 rounded-quiet-lg border border-border/50 bg-surface-low/60 p-4">
                  {draft.serviceType === "openai-compatible" ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-format`}>{fields["llm.apiFormat"].label}</Label>
                      <Select
                        value={draft.apiFormat}
                        onValueChange={(value) => edit({ apiFormat: value as LlmConnectionSettings["apiFormat"] })}
                      >
                        <SelectTrigger id={`${id}-format`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LLM_API_FORMAT_OPTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t.settings.options.llmApiFormat[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-reasoning`}>{fields["llm.reasoning"].label}</Label>
                      <Select
                        value={draft.reasoning}
                        onValueChange={(value) => edit({ reasoning: value as LlmConnectionSettings["reasoning"] })}
                      >
                        <SelectTrigger id={`${id}-reasoning`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {reasoningOptions.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-output`}>{fields["llm.outputFormat"].label}</Label>
                      <Select
                        value={draft.outputFormat}
                        onValueChange={(value) =>
                          edit({ outputFormat: value as LlmConnectionSettings["outputFormat"] })
                        }
                      >
                        <SelectTrigger id={`${id}-output`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {outputFormatOptions.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t.settings.options.llmOutputFormat[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-temperature`}>{fields["llm.temperature"].label}</Label>
                      <Input
                        id={`${id}-temperature`}
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={draft.temperature}
                        onChange={(event) => edit({ temperature: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-timeout`}>{fields["llm.timeout"].label}</Label>
                      <Input
                        id={`${id}-timeout`}
                        type="number"
                        min={1}
                        max={300}
                        value={draft.timeout}
                        onChange={(event) => edit({ timeout: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-retries`}>{fields["llm.maxRetries"].label}</Label>
                      <Input
                        id={`${id}-retries`}
                        type="number"
                        min={1}
                        max={20}
                        value={draft.maxRetries}
                        onChange={(event) => edit({ maxRetries: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${id}-rps`}>{fields["llm.maxRequestsPerSecond"].label}</Label>
                      <Input
                        id={`${id}-rps`}
                        type="number"
                        min={1}
                        max={100}
                        value={draft.maxRequestsPerSecond}
                        onChange={(event) => edit({ maxRequestsPerSecond: event.target.value })}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {feedback ? (
            <p role="status" className={cn("text-sm", feedback.ok ? "text-foreground" : "text-destructive")}>
              {feedback.text}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" disabled={testing} onClick={() => void handleVerify()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {testing ? text.testing : text.verify}
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={testing} onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="button" disabled={testing} onClick={handleSave}>
              {text.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
