import { Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";

interface SettingsSearchProps {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function SettingsSearch({ disabled = false, placeholder = "搜索设置", className }: SettingsSearchProps) {
  const search = useOptionalSettingsSearch();
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  if (!search) {
    return (
      <div className={cn("relative w-full max-w-[420px]", className)}>
        <Search className="pointer-events-none absolute left-3 top-[18px] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "h-9 w-full rounded-[var(--radius-quiet)] bg-surface-low pl-10 pr-3 text-sm text-foreground",
            "placeholder:text-muted-foreground outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            "focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        />
      </div>
    );
  }

  const suggestions = search.suggestions;
  const resolvedActiveSuggestionIndex = suggestions[activeSuggestionIndex] ? activeSuggestionIndex : 0;
  const activeSuggestion = suggestions[resolvedActiveSuggestionIndex] ?? null;

  return (
    <div className={cn("relative w-full max-w-[420px]", className)}>
      <Search className="pointer-events-none absolute left-3 top-[18px] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
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
          "h-9 w-full rounded-[var(--radius-quiet)] bg-surface-low pl-10 pr-3 text-sm text-foreground",
          "placeholder:text-muted-foreground outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
      />

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
