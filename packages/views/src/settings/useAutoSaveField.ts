import type { Configuration } from "@mdcz/shared/config";
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
import {
  buildAutoSaveFlatPayload,
  extractServerValidation,
  formatFieldLabel,
  isLatestRevision,
  nextRevision,
  runLatestRevisionTask,
  toFieldMessage,
  valuesEqual,
} from "./autoSaveUtils";
import { useSettingsNotifier, useSettingsServices } from "./SettingsServices";
import { unflattenConfig } from "./settingsRegistry";

export {
  buildAutoSaveFlatPayload,
  mergeConfigWithFlatPayload,
  runLatestRevisionTask,
  valuesEqual,
} from "./autoSaveUtils";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveFieldOptions {
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

export function SettingsEditorAutosaveProvider({
  children,
  savedValues,
  defaultValues = {},
  defaultValuesReady = false,
}: SettingsEditorAutosaveProviderProps) {
  const form = useFormContext<FieldValues>();
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [registeredFields, setRegisteredFields] = useState<Record<string, RegisteredAutoSaveField>>({});
  const [fieldStatuses, setFieldStatuses] = useState<Record<string, AutoSaveStatus>>({});
  const watchedPaths = useMemo(() => Object.keys(registeredFields), [registeredFields]);
  const watchedValues = useWatch({
    control: form.control,
    name: watchedPaths,
  }) as unknown[];

  const formRef = useRef(form);
  formRef.current = form;

  const servicesRef = useRef(services);
  servicesRef.current = services;
  const notifierRef = useRef(notifier);
  notifierRef.current = notifier;

  const fieldStatusesRef = useRef(fieldStatuses);
  fieldStatusesRef.current = fieldStatuses;

  const registeredFieldsRef = useRef(registeredFields);
  registeredFieldsRef.current = registeredFields;

  const savedValuesRef = useRef(savedValues);
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  const committedValuesRef = useRef<Map<string, unknown>>(new Map(Object.entries(savedValues)));
  const pendingProgrammaticValuesRef = useRef<Map<string, unknown>>(new Map());
  const pendingSaveValuesRef = useRef<Map<string, unknown>>(new Map());
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

  const enqueueSave = useCallback(
    (path: string, value: unknown, revision: number) => {
      servicesRef.current.incrementInFlightSaves();
      pendingSaveValuesRef.current.set(path, value);
      clearFieldTimers(path);
      setFieldStatus(path, "saving");

      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(() => {
          return runLatestRevisionTask({
            revisions: saveRevisionsRef.current,
            path,
            revision,
            finalize: () => servicesRef.current.decrementInFlightSaves(),
            run: async () => {
              const flatPayload = buildAutoSaveFlatPayload(path, value, formRef.current.formState.errors, (fieldPath) =>
                formRef.current.getValues(fieldPath),
              );
              const payloadPaths = Object.keys(flatPayload);

              try {
                await servicesRef.current.saveConfig(unflattenConfig(flatPayload) as Partial<Configuration>);

                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                for (const [payloadPath, payloadValue] of Object.entries(flatPayload)) {
                  committedValuesRef.current.set(payloadPath, payloadValue);
                  if (valuesEqual(pendingSaveValuesRef.current.get(payloadPath), payloadValue)) {
                    pendingSaveValuesRef.current.delete(payloadPath);
                  }
                }

                formRef.current.clearErrors(payloadPaths);
                servicesRef.current.updateCurrentConfigCache?.(flatPayload);
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
                  const message = toFieldMessage(error, "保存失败");
                  formRef.current.setError(path, {
                    type: "server",
                    message,
                  });
                  notifierRef.current.error(
                    `${formatFieldLabel(registeredFieldsRef.current[path]?.label, path)} 保存失败: ${message}`,
                  );
                }

                setFieldStatus(path, "error");
              }
            },
          });
        });
    },
    [clearFieldTimers, markFieldSaved, setFieldStatus],
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

      servicesRef.current.incrementInFlightSaves();
      setFieldStatus(path, "saving");

      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(() => {
          return runLatestRevisionTask({
            revisions: saveRevisionsRef.current,
            path,
            revision,
            finalize: () => servicesRef.current.decrementInFlightSaves(),
            run: async () => {
              try {
                await servicesRef.current.resetConfig(path);

                if (!isLatestRevision(saveRevisionsRef.current, path, revision)) {
                  return;
                }

                committedValuesRef.current.set(path, defaultValue);
                formRef.current.clearErrors(path);
                servicesRef.current.updateCurrentConfigCache?.({ [path]: defaultValue });
                markFieldSaved(path);

                notifierRef.current.success(`${fieldLabel} 已恢复为默认值`, {
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
                notifierRef.current.error(`${fieldLabel} 恢复失败: ${toFieldMessage(error, "未知错误")}`);
              }
            },
          });
        });
    },
    [clearFieldTimers, defaultValuesReady, markFieldSaved, programmaticSave, setFieldStatus],
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
        pendingSaveValuesRef.current.delete(path);

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
    pendingSaveValuesRef.current.clear();
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
        pendingSaveValuesRef.current.delete(path);
        if (fieldStatusesRef.current[path] === "error" && !formRef.current.getFieldState(path).error) {
          setFieldStatus(path, "idle");
        }
        continue;
      }

      if (valuesEqual(value, pendingSaveValuesRef.current.get(path))) {
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

      pendingSaveValuesRef.current.set(path, value);
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
