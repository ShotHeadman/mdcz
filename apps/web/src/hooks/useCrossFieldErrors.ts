import { useMemo } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { FIELD_REGISTRY, type FieldEntry } from "../components/settings/settingsRegistry";

export interface CrossFieldError {
  field: string;
  label: string;
  message: string;
}

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
