import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { valuesEqual } from "@/hooks/useAutoSaveField";

type BufferedField = ControllerRenderProps<FieldValues, string>;

export interface BufferedFieldControllerOptions {
  format?: (value: unknown) => string;
  parse?: (draft: string, currentValue: unknown) => unknown;
  commitOnEnter?: boolean;
}

export interface BufferedFieldControllerRenderProps {
  name: string;
  ref: BufferedField["ref"];
  value: string;
  handleFocus: () => void;
  handleBlur: () => void;
  handleChangeValue: (nextDraft: string) => void;
  handleCommitKey: <Element extends HTMLInputElement | HTMLTextAreaElement>(event: KeyboardEvent<Element>) => void;
}

interface BufferedFieldControlProps extends BufferedFieldControllerOptions {
  field: BufferedField;
  children: (props: BufferedFieldControllerRenderProps) => ReactNode;
}

function formatDraftValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function parseTextDraft(draft: string): string {
  return draft;
}

export function parseBufferedNumberValue(draft: string, currentValue: unknown): number {
  const trimmed = draft.trim();
  if (!trimmed) {
    return typeof currentValue === "number" && Number.isFinite(currentValue) ? currentValue : 0;
  }

  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return typeof currentValue === "number" && Number.isFinite(currentValue) ? currentValue : 0;
}

export function useBufferedFieldController(
  field: BufferedField,
  { format = formatDraftValue, parse = parseTextDraft, commitOnEnter = true }: BufferedFieldControllerOptions = {},
): BufferedFieldControllerRenderProps {
  const [draftValue, setDraftValue] = useState(() => format(field.value));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraftValue(format(field.value));
    }
  }, [field.value, format]);

  const commitDraft = () => {
    isFocusedRef.current = false;

    const nextValue = parse(draftValue, field.value);
    if (!valuesEqual(nextValue, field.value)) {
      field.onChange(nextValue);
      return;
    }

    setDraftValue(format(nextValue));
  };

  return {
    name: field.name,
    ref: field.ref,
    value: draftValue,
    handleFocus: () => {
      isFocusedRef.current = true;
    },
    handleBlur: () => {
      commitDraft();
      field.onBlur();
    },
    handleChangeValue: (nextDraft: string) => {
      isFocusedRef.current = true;
      setDraftValue(nextDraft);
    },
    handleCommitKey: (event) => {
      if (!commitOnEnter || event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      event.currentTarget.blur();
    },
  };
}

export function BufferedFieldControl({ field, children, ...options }: BufferedFieldControlProps) {
  const controller = useBufferedFieldController(field, options);
  return children(controller);
}
