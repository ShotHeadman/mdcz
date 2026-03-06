import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";

interface DurationFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
}

export function DurationField({ field }: DurationFieldProps) {
  return (
    <div className="w-full flex justify-end">
      <div className="relative">
        <FormControl>
          <Input
            type="number"
            {...field}
            onChange={(e) => field.onChange(Number(e.target.value))}
            className="h-8 w-24 text-sm bg-background/50 focus:bg-background transition-all pr-12 text-right"
          />
        </FormControl>
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-medium pointer-events-none opacity-50 uppercase">
          秒
        </span>
      </div>
    </div>
  );
}
