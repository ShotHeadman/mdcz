import type { Configuration } from "@shared/config";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { unflattenConfig } from "@/components/settings/settingsRegistry";
import { CURRENT_CONFIG_QUERY_KEY } from "@/hooks/configQueries";
import { queryClient } from "@/lib/queryClient";
import { useSettingsSavingStore } from "@/store/settingsSavingStore";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveFieldOptions {
  /**
   * "debounce": wait debounceMs after the last change before saving (free-text).
   * "immediate": save as soon as the value differs from the last saved value (discrete controls).
   */
  mode?: "debounce" | "immediate";
  debounceMs?: number;
  label?: string;
}

export interface UseAutoSaveFieldResult {
  status: AutoSaveStatus;
  resetToDefault: () => void;
}

interface RegisteredAutoSaveField {
  mode: "debounce" | "immediate";
  debounceMs: number;
  label?: string;
}

interface SettingsEditorAutosaveContextValue {
  registerField: (path: string, options: UseAutoSaveFieldOptions) => () => void;
  getFieldStatus: (path: string) => AutoSaveStatus;
  resetFieldToDefault: (path: string, label?: string) => void;
}

interface SettingsEditorAutosaveProviderProps {
  children?: ReactNode;
  savedValues: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
  defaultValuesReady?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 500;
const SAVED_FADE_MS = 1500;

const SettingsEditorAutosaveContext = createContext<SettingsEditorAutosaveContextValue | null>(null);

interface ServerValidationPayload {
  fields: string[];
  fieldErrors: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function extractServerValidation(error: unknown): ServerValidationPayload | null {
  if (!isRecord(error)) return null;
  const details = isRecord(error.details) ? error.details : undefined;
  const rootFields = toStringArray(error.fields);
  const rootFieldErrors = toStringRecord(error.fieldErrors);
  const fields = rootFields.length > 0 ? rootFields : toStringArray(details?.fields);
  const fieldErrors = Object.keys(rootFieldErrors).length > 0 ? rootFieldErrors : toStringRecord(details?.fieldErrors);

  if (fields.length === 0 && Object.keys(fieldErrors).length === 0) {
    return null;
  }

  const mergedFields = new Set<string>(fields);
  for (const key of Object.keys(fieldErrors)) {
    mergedFields.add(key);
  }

  return { fields: [...mergedFields], fieldErrors };
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function collectServerErrorPaths(errors: unknown, prefix = ""): string[] {
  if (Array.isArray(errors)) {
    return errors.flatMap((entry, index) =>
      collectServerErrorPaths(entry, prefix ? `${prefix}.${index}` : String(index)),
    );
  }

  if (!isRecord(errors)) {
    return [];
  }

  if (errors.type === "server") {
    return prefix ? [prefix] : [];
  }

  const paths: string[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (key === "root") {
      continue;
    }
    paths.push(...collectServerErrorPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

export function buildAutoSaveFlatPayload(
  path: string,
  value: unknown,
  errors: unknown,
  getValue: (fieldPath: string) => unknown,
): Record<string, unknown> {
  const relatedPaths = new Set([path, ...collectServerErrorPaths(errors)]);
  const flatPayload: Record<string, unknown> = {};

  for (const relatedPath of relatedPaths) {
    flatPayload[relatedPath] = relatedPath === path ? value : getValue(relatedPath);
  }

  return flatPayload;
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneConfigValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]));
  }

  return value;
}

function mergeConfigValue(base: unknown, override: unknown): unknown {
  if (Array.isArray(override)) {
    return cloneConfigValue(override);
  }

  if (isRecord(override)) {
    const next: Record<string, unknown> = isRecord(base)
      ? Object.fromEntries(Object.entries(base).map(([key, value]) => [key, cloneConfigValue(value)]))
      : {};

    for (const [key, value] of Object.entries(override)) {
      next[key] = mergeConfigValue(next[key], value);
    }

    return next;
  }

  return cloneConfigValue(override);
}

export function mergeConfigWithFlatPayload(
  baseConfig: Record<string, unknown>,
  flatPayload: Record<string, unknown>,
): Record<string, unknown> {
  return mergeConfigValue(baseConfig, unflattenConfig(flatPayload)) as Record<string, unknown>;
}

function formatFieldLabel(label: string | undefined, path: string): string {
  return label ? `“${label}”` : `“${path}”`;
}

function toFieldMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function nextRevision(revisions: Map<string, number>, path: string): number {
  const revision = (revisions.get(path) ?? 0) + 1;
  revisions.set(path, revision);
  return revision;
}

function isLatestRevision(revisions: Map<string, number>, path: string, revision: number): boolean {
  return (revisions.get(path) ?? 0) === revision;
}

interface LatestRevisionTaskOptions {
  revisions: Map<string, number>;
  path: string;
  revision: number;
  run: () => Promise<void>;
  finalize: () => void;
}

export async function runLatestRevisionTask({
  revisions,
  path,
  revision,
  run,
  finalize,
}: LatestRevisionTaskOptions): Promise<void> {
  try {
    if (!isLatestRevision(revisions, path, revision)) {
      return;
    }

    await run();
  } finally {
    finalize();
  }
}

export function SettingsEditorAutosaveProvider({
  children,
  savedValues,
  defaultValues = {},
  defaultValuesReady = false,
}: SettingsEditorAutosaveProviderProps) {
  const form = useFormContext<FieldValues>();
  const incrementInFlight = useSettingsSavingStore((state) => state.incrementInFlight);
  const decrementInFlight = useSettingsSavingStore((state) => state.decrementInFlight);
  const [registeredFields, setRegisteredFields] = useState<Record<string, RegisteredAutoSaveField>>({});
  const [fieldStatuses, setFieldStatuses] = useState<Record<string, AutoSaveStatus>>({});
  const watchedPaths = useMemo(() => Object.keys(registeredFields), [registeredFields]);
  const watchedValues = useWatch({
    control: form.control,
    name: watchedPaths,
  }) as unknown[];

  const formRef = useRef(form);
  formRef.current = form;

  const fieldStatusesRef = useRef(fieldStatuses);
  fieldStatusesRef.current = fieldStatuses;

  const registeredFieldsRef = useRef(registeredFields);
  registeredFieldsRef.current = registeredFields;

  const savedValuesRef = useRef(savedValues);
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  const committedValuesRef = useRef<Map<string, unknown>>(new Map(Object.entries(savedValues)));
  const pendingProgrammaticValuesRef = useRef<Map<string, unknown>>(new Map());
  const saveRevisionsRef = useRef<Map<string, number>>(new Map());
  const debounceTimersRef = useRef<Map<string, number>>(new Map());
  const fadeTimersRef = useRef<Map<string, number>>(new Map());
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const setFieldStatus = useCallback((path: string, status: AutoSaveStatus) => {
    setFieldStatuses((previous) => {
      if (previous[path] === status) {
        return previous;
      }

      return {
        ...previous,
        [path]: status,
      };
    });
  }, []);

  const clearFieldTimers = useCallback((path: string) => {
    const debounceTimer = debounceTimersRef.current.get(path);
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer);
      debounceTimersRef.current.delete(path);
    }

    const fadeTimer = fadeTimersRef.current.get(path);
    if (fadeTimer !== undefined) {
      window.clearTimeout(fadeTimer);
      fadeTimersRef.current.delete(path);
    }
  }, []);

  const markFieldSaved = useCallback(
    (path: string) => {
      clearFieldTimers(path);
      setFieldStatus(path, "saved");

      const fadeTimer = window.setTimeout(() => {
        fadeTimersRef.current.delete(path);
        setFieldStatuses((previous) => {
          if (previous[path] !== "saved") {
            return previous;
          }

          return {
            ...previous,
            [path]: "idle",
          };
        });
      }, SAVED_FADE_MS);

      fadeTimersRef.current.set(path, fadeTimer);
    },
    [clearFieldTimers, setFieldStatus],
  );

  const mergeCurrentConfigCache = useCallback((flatPayload: Record<string, unknown>) => {
    queryClient.setQueryData(CURRENT_CONFIG_QUERY_KEY, (previous) => {
      if (!isRecord(previous)) {
        return previous;
      }

      return mergeConfigWithFlatPayload(previous, flatPayload);
    });
  }, []);

  const enqueueSave = useCallback(
    (path: string, value: unknown, revision: number) => {
      incrementInFlight();
      clearFieldTimers(path);
      setFieldStatus(path, "saving");

      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(() => {
          return runLatestRevisionTask({
            revisions: saveRevisionsRef.current,
            path,
            revision,
            finalize: decrementInFlight,
            run: async () => {
              const flatPayload = buildAutoSaveFlatPayload(path, value, formRef.current.formState.errors, (fieldPath) =>
                formRef.current.getValues(fieldPath),
              );
              const payloadPaths = Object.keys(flatPayload);

              try {
                await ipc.config.save(unflattenConfig(flatPayload) as Partial<Configuration>);

                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                for (const [payloadPath, payloadValue] of Object.entries(flatPayload)) {
                  committedValuesRef.current.set(payloadPath, payloadValue);
                }

                formRef.current.clearErrors(payloadPaths);
                mergeCurrentConfigCache(flatPayload);
                markFieldSaved(path);
              } catch (error) {
                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                const serverError = extractServerValidation(error);
                if (serverError) {
                  const ownError = serverError.fieldErrors[path];
                  if (ownError) {
                    formRef.current.setError(path, { type: "server", message: ownError });
                  } else {
                    formRef.current.clearErrors(path);
                  }

                  for (const otherField of serverError.fields) {
                    if (otherField === path) {
                      continue;
                    }

                    const message = serverError.fieldErrors[otherField] ?? "校验失败";
                    formRef.current.setError(otherField, { type: "server", message });
                  }
                } else {
                  formRef.current.setError(path, {
                    type: "server",
                    message: toFieldMessage(error, "保存失败"),
                  });
                }

                setFieldStatus(path, "error");
              }
            },
          });
        });
    },
    [clearFieldTimers, decrementInFlight, incrementInFlight, markFieldSaved, mergeCurrentConfigCache, setFieldStatus],
  );

  const programmaticSave = useCallback(
    (path: string, value: unknown) => {
      clearFieldTimers(path);
      const revision = nextRevision(saveRevisionsRef.current, path);
      pendingProgrammaticValuesRef.current.set(path, value);
      formRef.current.setValue(path, value, {
        shouldDirty: true,
        shouldTouch: true,
      });
      enqueueSave(path, value, revision);
    },
    [clearFieldTimers, enqueueSave],
  );

  const resetFieldToDefault = useCallback(
    (path: string, label?: string) => {
      if (!defaultValuesReady || !Object.hasOwn(defaultValuesRef.current, path)) {
        return;
      }

      const defaultValue = defaultValuesRef.current[path];
      const previousValue = formRef.current.getValues(path);
      const fieldLabel = formatFieldLabel(label, path);

      clearFieldTimers(path);
      const revision = nextRevision(saveRevisionsRef.current, path);
      pendingProgrammaticValuesRef.current.set(path, defaultValue);
      formRef.current.setValue(path, defaultValue, {
        shouldDirty: true,
        shouldTouch: true,
      });

      incrementInFlight();
      setFieldStatus(path, "saving");

      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(() => {
          return runLatestRevisionTask({
            revisions: saveRevisionsRef.current,
            path,
            revision,
            finalize: decrementInFlight,
            run: async () => {
              try {
                await ipc.config.reset(path);

                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                committedValuesRef.current.set(path, defaultValue);
                formRef.current.clearErrors(path);
                mergeCurrentConfigCache({ [path]: defaultValue });
                markFieldSaved(path);

                toast.success(`${fieldLabel} 已恢复为默认值`, {
                  action: {
                    label: "撤销",
                    onClick: () => {
                      programmaticSave(path, previousValue);
                    },
                  },
                });
              } catch (error) {
                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                pendingProgrammaticValuesRef.current.set(path, previousValue);
                formRef.current.setValue(path, previousValue, {
                  shouldDirty: true,
                  shouldTouch: true,
                });
                formRef.current.setError(path, {
                  type: "server",
                  message: toFieldMessage(error, "恢复默认值失败"),
                });
                setFieldStatus(path, "error");
                toast.error(`${fieldLabel} 恢复失败: ${toFieldMessage(error, "未知错误")}`);
              }
            },
          });
        });
    },
    [
      clearFieldTimers,
      decrementInFlight,
      defaultValuesReady,
      incrementInFlight,
      markFieldSaved,
      mergeCurrentConfigCache,
      programmaticSave,
      setFieldStatus,
    ],
  );

  const registerField = useCallback(
    (path: string, options: UseAutoSaveFieldOptions) => {
      setRegisteredFields((previous) => {
        const nextField: RegisteredAutoSaveField = {
          mode: options.mode ?? "immediate",
          debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
          label: options.label,
        };

        const current = previous[path];
        if (
          current?.mode === nextField.mode &&
          current?.debounceMs === nextField.debounceMs &&
          current?.label === nextField.label
        ) {
          return previous;
        }

        return {
          ...previous,
          [path]: nextField,
        };
      });

      if (!committedValuesRef.current.has(path)) {
        committedValuesRef.current.set(path, formRef.current.getValues(path));
      }

      return () => {
        clearFieldTimers(path);
        pendingProgrammaticValuesRef.current.delete(path);

        setRegisteredFields((previous) => {
          if (!(path in previous)) {
            return previous;
          }

          const next = { ...previous };
          delete next[path];
          return next;
        });
      };
    },
    [clearFieldTimers],
  );

  useEffect(() => {
    if (savedValuesRef.current === savedValues) {
      return;
    }

    savedValuesRef.current = savedValues;
    committedValuesRef.current = new Map(Object.entries(savedValues));
    pendingProgrammaticValuesRef.current.clear();
    saveRevisionsRef.current.clear();

    const pendingPaths = new Set([...debounceTimersRef.current.keys(), ...fadeTimersRef.current.keys()]);
    for (const path of pendingPaths) {
      clearFieldTimers(path);
    }

    setFieldStatuses({});
  }, [clearFieldTimers, savedValues]);

  useEffect(() => {
    for (const [index, path] of watchedPaths.entries()) {
      const value = watchedValues[index];

      if (pendingProgrammaticValuesRef.current.has(path)) {
        const pendingProgrammaticValue = pendingProgrammaticValuesRef.current.get(path);
        if (valuesEqual(value, pendingProgrammaticValue)) {
          pendingProgrammaticValuesRef.current.delete(path);
          continue;
        }

        pendingProgrammaticValuesRef.current.delete(path);
      }

      const committedValue = committedValuesRef.current.get(path);
      if (valuesEqual(value, committedValue)) {
        if (fieldStatusesRef.current[path] === "error" && !formRef.current.getFieldState(path).error) {
          setFieldStatus(path, "idle");
        }
        continue;
      }

      const field = registeredFieldsRef.current[path];
      if (!field) {
        continue;
      }

      clearFieldTimers(path);
      const revision = nextRevision(saveRevisionsRef.current, path);

      if (field.mode === "immediate") {
        enqueueSave(path, value, revision);
        continue;
      }

      const debounceTimer = window.setTimeout(() => {
        debounceTimersRef.current.delete(path);
        enqueueSave(path, value, revision);
      }, field.debounceMs);

      debounceTimersRef.current.set(path, debounceTimer);
    }
  }, [clearFieldTimers, enqueueSave, setFieldStatus, watchedPaths, watchedValues]);

  useEffect(() => {
    return () => {
      for (const timer of debounceTimersRef.current.values()) {
        window.clearTimeout(timer);
      }

      for (const timer of fadeTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const contextValue = useMemo<SettingsEditorAutosaveContextValue>(
    () => ({
      registerField,
      getFieldStatus: (path) => fieldStatuses[path] ?? "idle",
      resetFieldToDefault,
    }),
    [fieldStatuses, registerField, resetFieldToDefault],
  );

  return createElement(SettingsEditorAutosaveContext.Provider, { value: contextValue }, children);
}

export function useAutoSaveField(path: string, options: UseAutoSaveFieldOptions = {}): UseAutoSaveFieldResult {
  const autosave = useContext(SettingsEditorAutosaveContext);
  if (!autosave) {
    throw new Error("useAutoSaveField must be used within <SettingsEditorAutosaveProvider>");
  }
  const { getFieldStatus, registerField, resetFieldToDefault } = autosave;

  const registrationOptions = useMemo(
    () => ({
      mode: options.mode,
      debounceMs: options.debounceMs,
      label: options.label,
    }),
    [options.debounceMs, options.label, options.mode],
  );

  useEffect(() => registerField(path, registrationOptions), [path, registerField, registrationOptions]);

  return {
    status: getFieldStatus(path),
    resetToDefault: () => resetFieldToDefault(path, options.label),
  };
}
