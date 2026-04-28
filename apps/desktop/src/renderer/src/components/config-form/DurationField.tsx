import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { BufferedFieldControl, parseBufferedNumberValue } from "./BufferedFieldControls";

interface DurationFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
}

export function DurationField({ field }: DurationFieldProps) {
  return (
    <div className="flex w-full justify-end">
      <BufferedFieldControl field={field} parse={parseBufferedNumberValue}>
        {(control) => (
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                type="number"
                name={control.name}
                ref={control.ref}
                value={control.value}
                onFocus={control.handleFocus}
                onChange={(event) => control.handleChangeValue(event.target.value)}
                onBlur={control.handleBlur}
                onKeyDown={control.handleCommitKey}
                className="h-8 w-24 appearance-none bg-background/50 text-right text-sm transition-all focus:bg-background"
              />
            </FormControl>
            <span
              aria-hidden="true"
              className="min-w-[1.25rem] text-[10px] font-medium uppercase leading-none text-muted-foreground/70"
            >
              秒
            </span>
          </div>
        )}
      </BufferedFieldControl>
    </div>
  );
}
