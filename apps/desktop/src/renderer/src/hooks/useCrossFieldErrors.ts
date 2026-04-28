import { useMemo } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { FIELD_REGISTRY, type FieldEntry } from "@/components/settings/settingsRegistry";

export interface CrossFieldError {
  field: string;
  label: string;
  message: string;
}

/**
 * Collects server-originated validation errors for every field registered
 * under a given top-level anchor section (one of `FieldEntry["anchor"]`).
 *
 * Used by `CrossFieldBanner` to surface errors reported against *other*
 * fields when an auto-save of one field triggers a whole-config validation.
 * The canonical motivating case (see prd.md §R2) is:
 *
 *   `translate.engine = openai` + empty `translate.llmApiKey`
 *     → server rejects with `fieldErrors: { "translate.llmApiKey": ... }`
 *     → `useAutoSaveField` calls `form.setError("translate.llmApiKey", ...)`
 *     → this hook picks up the server-typed error and the banner appears on
 *       the owning section.
 *
 * The banner is cleared automatically once a subsequent successful auto-save
 * of the offending field calls `form.clearErrors(path)`.
 */
export function useCrossFieldErrors(sectionKey: FieldEntry["anchor"]): CrossFieldError[] {
  const form = useFormContext();
  const formState = useFormState({ control: form.control });

  return useMemo(() => {
    const output: CrossFieldError[] = [];
    for (const entry of FIELD_REGISTRY) {
      if (entry.surface !== "settings") continue;
      if (entry.anchor !== sectionKey) continue;
      const fieldState = form.getFieldState(entry.key, formState);
      const fieldError = fieldState.error;
      if (!fieldError || fieldError.type !== "server") continue;
      output.push({
        field: entry.key,
        label: entry.label,
        message:
          typeof fieldError.message === "string" && fieldError.message.length > 0 ? fieldError.message : "校验失败",
      });
    }
    return output;
  }, [form, formState, sectionKey]);
}
