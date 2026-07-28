import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  FormControl,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@mdcz/ui";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

export type ChipArrayOption = string | { value: string; label: string };

interface ChipArrayFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
  placeholder?: string;
  options?: ChipArrayOption[]; // If provided, use a multi-select dropdown instead of free-form input
  showBulkActions?: boolean;
  defaultOpen?: boolean;
}

export function ChipArrayField({
  field,
  placeholder,
  options,
  showBulkActions = false,
  defaultOpen = false,
}: ChipArrayFieldProps) {
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const values: string[] = Array.isArray(field.value) ? field.value : [];
  const resolvedOptions = Array.isArray(options)
    ? options.map((option) => (typeof option === "string" ? { value: option, label: option } : option))
    : [];
  const hasOptions = resolvedOptions.length > 0;
  const labelByValue = new Map(resolvedOptions.map((option) => [option.value, option.label]));
  const allOptionsSelected =
    hasOptions &&
    values.length === resolvedOptions.length &&
    resolvedOptions.every((option) => values.includes(option.value));

  const addValues = (newValues: string[]) => {
    const next = [...values];
    let changed = false;
    for (const raw of newValues) {
      const trimmed = raw.trim();
      if (trimmed && !next.includes(trimmed)) {
        next.push(trimmed);
        changed = true;
      }
    }
    if (changed) {
      field.onChange(next);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      e.preventDefault();
      if (inputValue.trim()) {
        addValues(inputValue.split(/[,，\s]+/));
        setInputValue("");
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes(",") || pasted.includes("，") || pasted.includes("\n") || pasted.includes(" ")) {
      e.preventDefault();
      addValues(pasted.split(/[,，\s\r\n]+/));
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
                className="min-h-8 h-auto py-1.5 px-2.5 w-full bg-background/50 hover:bg-background focus:outline-none focus:ring-1 focus:ring-primary/20 border border-input rounded-md transition-all flex flex-wrap gap-1.5 items-center justify-start text-left overflow-hidden cursor-pointer"
              >
                <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-0">
                  {values.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{placeholder || "未选择可选字段"}</span>
                  ) : allOptionsSelected ? (
                    <span className="text-xs font-medium text-foreground">已选择 {resolvedOptions.length} 个字段</span>
                  ) : values.length > 3 ? (
                    <span className="text-xs font-medium text-foreground">
                      已选择 {values.length} 个字段 (
                      {values
                        .slice(0, 2)
                        .map((v) => labelByValue.get(v) ?? v)
                        .join(", ")}{" "}
                      等)
                    </span>
                  ) : (
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
                        {labelByValue.get(value) ?? value}
                        <X className="h-2.5 w-2.5 opacity-60 hover:opacity-100 transition-opacity" />
                      </Badge>
                    ))
                  )}
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40 ml-1" />
              </button>
            </PopoverTrigger>
          </FormControl>
          <PopoverContent className="w-[320px] p-0" align="end" disablePortal={defaultOpen}>
            <Command>
              <CommandInput placeholder="搜索字段..." className="h-8 text-xs" />
              {showBulkActions && hasOptions && (
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs bg-background">
                  <span className="mr-auto text-[11px] text-muted-foreground">
                    已选 {values.length}/{resolvedOptions.length}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => field.onChange(resolvedOptions.map((option) => option.value))}
                    disabled={allOptionsSelected}
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => field.onChange([])}
                    disabled={values.length === 0}
                  >
                    全不选
                  </Button>
                </div>
              )}
              <CommandList className="max-h-60 overflow-y-auto">
                <CommandEmpty className="text-xs py-3">无匹配字段</CommandEmpty>
                <CommandGroup>
                  {resolvedOptions.map((option) => {
                    const isSelected = values.includes(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.value}`}
                        onSelect={() => toggleOption(option.value)}
                        className="text-xs cursor-pointer"
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                        {option.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        // Free-form tag mode
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-2">
            <FormControl>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={placeholder || "输入文本，按 Enter 或逗号添加..."}
                className="h-8 flex-1 text-sm bg-background/50 focus:bg-background transition-all"
              />
            </FormControl>
            <Button
              type="button"
              onClick={() => {
                if (inputValue.trim()) {
                  addValues(inputValue.split(/[,，\s]+/));
                  setInputValue("");
                }
              }}
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs shrink-0"
            >
              添加
            </Button>
          </div>

          {values.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 p-2 rounded-md bg-muted/20 border border-dashed border-border/50">
              {values.map((value: string) => (
                <Badge
                  key={value}
                  variant="secondary"
                  className="pl-2 pr-1 py-0.5 h-6 text-xs font-medium bg-background border shadow-xs gap-1.5 shrink-0 group"
                >
                  <span>{value}</span>
                  <X
                    className="h-3 w-3 opacity-50 hover:opacity-100 rounded-xs hover:bg-destructive/20 hover:text-destructive transition-all cursor-pointer"
                    onClick={() => removeValue(value)}
                  />
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60 italic px-1">暂无配置词汇</div>
          )}
        </div>
      )}
    </div>
  );
}
