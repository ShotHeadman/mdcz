import { cn } from "@mdcz/ui";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";

interface SettingsSearchProps {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function SettingsSearch({ disabled = false, placeholder = "搜索设置", className }: SettingsSearchProps) {
  const search = useOptionalSettingsSearch();
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled]);

  if (!search) {
    return (
      <div className={cn("relative w-full max-w-[320px] md:max-w-[380px]", className)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "h-9 w-full rounded-[var(--radius-quiet)] border border-border/40 bg-surface-low/80 pl-9 pr-9 text-sm text-foreground",
            "placeholder:text-muted-foreground outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60",
            "hover:bg-surface-low focus:border-border focus:bg-surface focus-visible:ring-2 focus-visible:ring-ring/30",
          )}
        />
      </div>
    );
  }

  const suggestions = search.suggestions;
  const resolvedActiveSuggestionIndex = suggestions[activeSuggestionIndex] ? activeSuggestionIndex : 0;
  const activeSuggestion = suggestions[resolvedActiveSuggestionIndex] ?? null;

  return (
    <div className={cn("relative w-full max-w-[320px] md:max-w-[380px]", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls="settings-search-suggestions"
        aria-activedescendant={activeSuggestion ? `settings-suggestion-${activeSuggestion.id}` : undefined}
        value={search.query}
        disabled={disabled}
        onChange={(event) => {
          setActiveSuggestionIndex(0);
          search.setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            if (search.query) {
              search.setQuery("");
              setActiveSuggestionIndex(0);
            } else {
              inputRef.current?.blur();
            }
            return;
          }

          if (event.key === "ArrowDown" && suggestions.length > 0) {
            event.preventDefault();
            setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
            return;
          }

          if (event.key === "ArrowUp" && suggestions.length > 0) {
            event.preventDefault();
            setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            if (activeSuggestion) {
              setActiveSuggestionIndex(0);
              search.applySuggestion(activeSuggestion);
              return;
            }
            search.focusFirstMatch();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-[var(--radius-quiet)] border border-border/40 bg-surface-low/80 pl-9 pr-14 text-sm text-foreground",
          "placeholder:text-muted-foreground outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60",
          "hover:bg-surface-low focus:border-border focus:bg-surface focus-visible:ring-2 focus-visible:ring-ring/30",
        )}
      />

      {search.query && !disabled ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            search.setQuery("");
            setActiveSuggestionIndex(0);
            inputRef.current?.focus();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-surface-low hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : !disabled ? (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden select-none rounded border border-border/60 bg-surface/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground/80 shadow-2xs sm:inline-block">
          Ctrl K
        </kbd>
      ) : null}

      {suggestions.length > 0 && !disabled && (
        <div
          id="settings-search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-20 overflow-hidden rounded-[var(--radius-quiet-lg)] border border-border/50 bg-surface-floating p-1 shadow-[0_20px_60px_-28px_rgba(15,23,42,0.45)]"
        >
          {suggestions.map((suggestion, index) => {
            const isActive = index === resolvedActiveSuggestionIndex;
            return (
              <button
                key={suggestion.id}
                id={`settings-suggestion-${suggestion.id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setActiveSuggestionIndex(0);
                  search.applySuggestion(suggestion);
                }}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-[var(--radius-quiet-sm)] px-3 py-2 text-left outline-none transition-colors",
                  isActive ? "bg-surface-low text-foreground" : "text-foreground hover:bg-surface-low/80",
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{suggestion.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{suggestion.description}</span>
                </span>
                <span className="shrink-0 rounded-full bg-surface-low px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {suggestion.kind}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
