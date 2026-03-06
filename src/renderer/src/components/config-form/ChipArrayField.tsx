import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/Command";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

interface ChipArrayFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
  placeholder?: string;
  options?: string[]; // If provided, use a multi-select dropdown instead of free-form input
}

export function ChipArrayField({ field, placeholder, options }: ChipArrayFieldProps) {
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const values: string[] = Array.isArray(field.value) ? field.value : [];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addValue(inputValue);
    }
  };

  const addValue = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !values.includes(trimmed)) {
      field.onChange([...values, trimmed]);
      setInputValue("");
    }
  };

  const removeValue = (valueToRemove: string) => {
    field.onChange(values.filter((v: string) => v !== valueToRemove));
  };

  const toggleOption = (opt: string) => {
    if (values.includes(opt)) {
      removeValue(opt);
    } else {
      field.onChange([...values, opt]);
    }
  };

  return (
    <div className="w-full flex justify-end min-h-0">
      {options ? (
        <Popover open={open} onOpenChange={setOpen}>
          <FormControl>
            <PopoverTrigger asChild>
              <button
                type="button"
                role="combobox"
                aria-expanded={open}
                className="min-h-8 h-auto py-1.5 px-2 w-full bg-background/50 hover:bg-background focus:outline-none focus:ring-1 focus:ring-primary/20 border border-input rounded-md transition-all flex flex-wrap gap-1.5 items-center justify-start text-left overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 items-center flex-1">
                  {values.length > 0 ? (
                    values.map((value: string) => (
                      <Badge
                        key={value}
                        variant="secondary"
                        className="pl-1.5 pr-1 py-0 h-5 text-[10px] font-medium bg-muted hover:bg-muted/80 border-none gap-1 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeValue(value);
                        }}
                      >
                        {value}
                        <X className="h-2.5 w-2.5 opacity-60 hover:opacity-100 transition-opacity" />
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground ml-1">{placeholder || "选择并添加..."}</span>
                  )}
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40 ml-1" />
              </button>
            </PopoverTrigger>
          </FormControl>
          <PopoverContent className="w-[320px] p-0" align="end">
            <Command>
              <CommandInput placeholder="搜索..." className="h-8 text-xs" />
              <CommandList>
                <CommandEmpty className="text-xs py-3">无匹配选项</CommandEmpty>
                <CommandGroup>
                  {options.map((opt) => {
                    const isSelected = values.includes(opt);
                    return (
                      <CommandItem
                        key={opt}
                        value={opt}
                        onSelect={() => toggleOption(opt)}
                        className="text-xs cursor-pointer"
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                        {opt}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        // For free-form tags (e.g. naming rules if needed)
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-2">
            <FormControl>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder || "输入并添加..."}
                className="h-8 flex-1 text-sm bg-background/50 focus:bg-background transition-all"
              />
            </FormControl>
            <Button
              type="button"
              onClick={() => addValue(inputValue)}
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs shrink-0"
            >
              添加
            </Button>
          </div>
          {values.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-1.5 rounded-md bg-muted/20 border border-dashed border-border/50">
              {values.map((value: string) => (
                <Badge
                  key={value}
                  variant="secondary"
                  className="pl-1.5 pr-1 py-0 h-5 text-[10px] font-medium bg-background border shadow-sm gap-1 shrink-0"
                >
                  {value}
                  <X
                    className="h-2.5 w-2.5 opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={() => removeValue(value)}
                  />
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
