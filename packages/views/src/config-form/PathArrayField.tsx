import { Button } from "@mdcz/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { useT } from "../i18n";
import { ServerPathField } from "./ServerPathField";

interface PathArrayFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
}

const toPathValues = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

export function PathArrayField({ field }: PathArrayFieldProps) {
  const t = useT();
  const values = toPathValues(field.value);
  const nextIdRef = useRef(0);
  const [rowIds, setRowIds] = useState<string[]>(() => values.map(() => `path-${nextIdRef.current++}`));

  useEffect(() => {
    setRowIds((currentIds) => {
      if (currentIds.length === values.length) {
        return currentIds;
      }
      if (currentIds.length > values.length) {
        return currentIds.slice(0, values.length);
      }
      return [
        ...currentIds,
        ...Array.from({ length: values.length - currentIds.length }, () => `path-${nextIdRef.current++}`),
      ];
    });
  }, [values.length]);

  const updateValue = (index: number, nextValue: string) => {
    field.onChange(values.map((value, valueIndex) => (valueIndex === index ? nextValue : value)));
  };

  const removeValue = (index: number) => {
    setRowIds((currentIds) => currentIds.filter((_, valueIndex) => valueIndex !== index));
    field.onChange(values.filter((_, valueIndex) => valueIndex !== index));
  };

  const addValue = () => {
    setRowIds((currentIds) => [...currentIds, `path-${nextIdRef.current++}`]);
    field.onChange([...values, ""]);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {values.map((value, index) => {
        const rowId = rowIds[index] ?? value;
        const itemField = {
          ...field,
          name: `${field.name}.${index}`,
          value,
          onChange: (nextValue: string) => updateValue(index, String(nextValue ?? "")),
        } satisfies ControllerRenderProps<FieldValues, string>;

        return (
          <div key={rowId} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ServerPathField
                field={itemField}
                isDirectory
                placeholder={index === 0 ? t.configForm.pathArray.firstPlaceholder : undefined}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0 h-8 w-8 shrink-0"
              aria-label={t.configForm.pathArray.remove}
              onClick={() => removeValue(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={addValue}>
          <Plus className="h-3.5 w-3.5" />
          {t.configForm.pathArray.add}
        </Button>
      </div>
    </div>
  );
}
