import { cn, Input } from "@mdcz/ui";
import { Loader2 } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

const SUGGEST_DELAY_MS = 180;

export interface PathAutocompleteSuggestion {
  label: string;
  path: string;
}

export interface PathAutocompleteResult {
  entries: PathAutocompleteSuggestion[];
  accessible?: boolean;
  error?: string;
}

export interface PathAutocompleteInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "className" | "onBlur" | "onChange" | "placeholder" | "readOnly" | "value"
  > {
  id?: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  staticSuggestions?: PathAutocompleteSuggestion[];
  loadSuggestions?: (value: string) => Promise<PathAutocompleteResult>;
}

const normalizeSuggestionPathKey = (value: string): string => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return (normalized || value.trim().replaceAll("\\", "/")).toLocaleLowerCase();
};

export const dedupePathAutocompleteSuggestions = (
  suggestions: PathAutocompleteSuggestion[],
): PathAutocompleteSuggestion[] => {
  const seen = new Set<string>();
  const deduped: PathAutocompleteSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = normalizeSuggestionPathKey(suggestion.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
};

export function PathAutocompleteInput({
  value,
  id,
  onChange,
  onBlur,
  placeholder,
  readOnly,
  className,
  inputClassName,
  staticSuggestions = [],
  loadSuggestions,
  ...inputProps
}: PathAutocompleteInputProps) {
  const listId = useId();
  const requestRef = useRef(0);
  const blurTimerRef = useRef<number | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<PathAutocompleteSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const canSuggest = Boolean(onChange && !readOnly);

  const fallbackEntries = useMemo(() => {
    const needle = value.trim().toLocaleLowerCase();
    return dedupePathAutocompleteSuggestions(
      staticSuggestions.filter((suggestion) => {
        if (!needle) {
          return true;
        }
        return (
          suggestion.path.toLocaleLowerCase().includes(needle) || suggestion.label.toLocaleLowerCase().includes(needle)
        );
      }),
    );
  }, [staticSuggestions, value]);

  const visibleEntries = loadSuggestions ? entries : fallbackEntries;
  const showPanel = open && canSuggest && (loading || Boolean(error) || visibleEntries.length > 0 || loaded);

  useEffect(() => {
    if (!open || !canSuggest || !loadSuggestions) {
      setLoading(false);
      setEntries([]);
      setError("");
      setLoaded(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError("");
    setLoaded(false);

    const timer = window.setTimeout(() => {
      loadSuggestions(value)
        .then((result) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setEntries(dedupePathAutocompleteSuggestions(result.entries));
          setError(result.accessible === false ? (result.error ?? "目录不可访问") : "");
          setLoaded(true);
          setActiveIndex(0);
        })
        .catch((suggestError) => {
          if (requestRef.current !== requestId) {
            return;
          }
          setEntries([]);
          setError(suggestError instanceof Error ? suggestError.message : String(suggestError));
          setLoaded(true);
          setActiveIndex(0);
        })
        .finally(() => {
          if (requestRef.current === requestId) {
            setLoading(false);
          }
        });
    }, SUGGEST_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canSuggest, loadSuggestions, open, value]);

  useEffect(() => {
    if (!showPanel) {
      return;
    }
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showPanel]);

  const selectEntry = (entry: PathAutocompleteSuggestion) => {
    onChange?.(entry.path);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }

    if (!showPanel) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleEntries.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && visibleEntries[activeIndex]) {
      event.preventDefault();
      selectEntry(visibleEntries[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        id={id}
        {...inputProps}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={showPanel ? listId : undefined}
        aria-expanded={showPanel}
        className={inputClassName}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => {
            setOpen(false);
            onBlur?.();
          }, 120);
        }}
        onChange={(event) => {
          onChange?.(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          if (blurTimerRef.current) {
            window.clearTimeout(blurTimerRef.current);
          }
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-quiet-sm border border-border/60 bg-surface-floating p-1 shadow-[0_18px_50px_-32px_rgba(0,0,0,0.55)]"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在读取目录
            </div>
          ) : null}
          {!loading && error ? <div className="px-3 py-2 text-xs text-muted-foreground">{error}</div> : null}
          {!loading && !error && visibleEntries.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">没有可用的子目录</div>
          ) : null}
          {!loading && !error
            ? visibleEntries.map((entry, index) => (
                <button
                  key={entry.path}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex w-full min-w-0 flex-col rounded-quiet-sm px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    index === activeIndex ? "bg-surface-raised" : "hover:bg-surface-low",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectEntry(entry)}
                >
                  <span className="truncate text-sm font-medium text-foreground">{entry.label}</span>
                  <span className="mt-0.5 w-full truncate font-mono text-[11px] text-muted-foreground">
                    {entry.path}
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
