import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import {
  getSettingsSuggestions,
  getVisibleEntries,
  isIdTargetMatch,
  type ParsedSettingsQuery,
  parseSettingsQuery,
  removeToken,
  replaceLastToken,
  type SettingsSuggestion,
  valuesEqual,
} from "./settingsFilter";
import { FIELD_KEYS, FIELD_REGISTRY, type FieldAnchor, type FieldEntry, flattenConfig } from "./settingsRegistry";

interface SettingsSearchContextValue {
  query: string;
  setQuery: (value: string) => void;
  parsedQuery: ParsedSettingsQuery;
  hasActiveFilters: boolean;
  resultCount: number;
  firstMatch: FieldEntry | null;
  suggestions: SettingsSuggestion[];
  showAdvanced: boolean;
  isAdvancedVisible: boolean;
  isAdvancedTokenActive: boolean;
  hasVisibleAdvancedEntries: boolean;
  toggleShowAdvanced: () => void;
  clearAdvancedToken: () => void;
  applySuggestion: (suggestion: SettingsSuggestion) => void;
  isFieldVisible: (key: string) => boolean;
  isFieldHighlighted: (key: string) => boolean;
  isFieldModified: (key: string) => boolean;
  isFieldIdTargeted: (key: string) => boolean;
  isAnchorVisible: (anchor: FieldAnchor) => boolean;
  isAdvancedAnchorVisible: (anchor: FieldAnchor) => boolean;
  focusFirstMatch: () => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

function focusFieldInDom(field: string): boolean {
  const selector = `[data-field-name="${CSS.escape(field)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return false;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = element.querySelector<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button, [role='combobox'], [role='button'], [tabindex]:not([tabindex='-1'])",
  );
  focusable?.focus();
  return true;
}

interface SettingsSearchProviderProps {
  children: ReactNode;
  defaultConfig: Record<string, unknown>;
  defaultConfigReady?: boolean;
  deepLinkSettingKey?: string | null;
}

function buildIdQuery(settingKey: string | null | undefined): string {
  const normalized = settingKey?.trim();
  return normalized ? `@id:${normalized}` : "";
}

export function SettingsSearchProvider({
  children,
  defaultConfig,
  defaultConfigReady = false,
  deepLinkSettingKey = null,
}: SettingsSearchProviderProps) {
  const form = useFormContext<FieldValues>();
  const deepLinkQuery = buildIdQuery(deepLinkSettingKey);
  const [query, setQuery] = useState(deepLinkQuery);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const focusedDeepLinkKeyRef = useRef<string | null>(null);
  const lastDeepLinkQueryRef = useRef(deepLinkQuery);
  const watchedValues = useWatch({
    control: form.control,
    name: FIELD_KEYS,
  }) as unknown[];

  const defaultValues = useMemo(() => flattenConfig(defaultConfig), [defaultConfig]);
  const parsedQuery = useMemo(() => parseSettingsQuery(deferredQuery), [deferredQuery]);
  const suggestions = useMemo(() => getSettingsSuggestions(query), [query]);

  const modifiedKeys = useMemo(() => {
    if (!defaultConfigReady) {
      return new Set<string>();
    }

    const next = new Set<string>();
    for (const [index, key] of FIELD_KEYS.entries()) {
      if (!valuesEqual(watchedValues[index], defaultValues[key])) {
        next.add(key);
      }
    }
    return next;
  }, [defaultConfigReady, defaultValues, watchedValues]);

  const visibleEntries = useMemo(
    () =>
      getVisibleEntries(FIELD_REGISTRY, {
        parsedQuery,
        showAdvanced,
        modifiedKeys,
      }),
    [modifiedKeys, parsedQuery, showAdvanced],
  );

  const visibleKeySet = useMemo(() => new Set(visibleEntries.map((entry) => entry.key)), [visibleEntries]);
  const visiblePublicAnchorSet = useMemo(
    () => new Set(visibleEntries.filter((entry) => entry.visibility === "public").map((entry) => entry.anchor)),
    [visibleEntries],
  );
  const visibleAdvancedAnchorSet = useMemo(
    () => new Set(visibleEntries.filter((entry) => entry.visibility === "advanced").map((entry) => entry.anchor)),
    [visibleEntries],
  );
  const firstMatch = visibleEntries[0] ?? null;
  const hasActiveFilters = parsedQuery.hasFilters;
  const isAdvancedTokenActive = parsedQuery.advanced;
  const isAdvancedVisible = showAdvanced || isAdvancedTokenActive;
  const hasVisibleAdvancedEntries = visibleEntries.some((entry) => entry.visibility === "advanced");

  const applySuggestion = useCallback((suggestion: SettingsSuggestion) => {
    setQuery((previous) => replaceLastToken(previous, suggestion.insertValue));
  }, []);

  const clearAdvancedToken = useCallback(() => {
    setQuery((previous) => removeToken(previous, "@advanced"));
  }, []);

  const focusFirstMatch = useCallback(() => {
    for (const entry of visibleEntries) {
      if (focusFieldInDom(entry.key)) {
        return;
      }
    }
  }, [visibleEntries]);

  const isFieldVisible = useCallback((key: string) => visibleKeySet.has(key), [visibleKeySet]);
  const isFieldHighlighted = useCallback(
    (key: string) => hasActiveFilters && visibleKeySet.has(key),
    [hasActiveFilters, visibleKeySet],
  );
  const isFieldModified = useCallback((key: string) => modifiedKeys.has(key), [modifiedKeys]);
  const isFieldIdTargeted = useCallback(
    (key: string) => {
      const entry = FIELD_REGISTRY.find((item) => item.key === key);
      return entry ? isIdTargetMatch(entry, parsedQuery) : false;
    },
    [parsedQuery],
  );
  const isAnchorVisible = useCallback(
    (anchor: FieldAnchor) => visiblePublicAnchorSet.has(anchor),
    [visiblePublicAnchorSet],
  );
  const isAdvancedAnchorVisible = useCallback(
    (anchor: FieldAnchor) => visibleAdvancedAnchorSet.has(anchor),
    [visibleAdvancedAnchorSet],
  );

  useEffect(() => {
    if (showAdvanced && isAdvancedTokenActive) {
      setShowAdvanced(false);
    }
  }, [isAdvancedTokenActive, showAdvanced]);

  useEffect(() => {
    const previousDeepLinkQuery = lastDeepLinkQueryRef.current;
    if (previousDeepLinkQuery === deepLinkQuery) {
      return;
    }

    lastDeepLinkQueryRef.current = deepLinkQuery;
    focusedDeepLinkKeyRef.current = null;

    setQuery((previous) => {
      if (!deepLinkQuery) {
        return previous === previousDeepLinkQuery ? "" : previous;
      }

      return previous === deepLinkQuery ? previous : deepLinkQuery;
    });
  }, [deepLinkQuery]);

  useEffect(() => {
    const normalizedKey = deepLinkSettingKey?.trim();
    if (!normalizedKey || focusedDeepLinkKeyRef.current === normalizedKey || !visibleKeySet.has(normalizedKey)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (focusFieldInDom(normalizedKey)) {
        focusedDeepLinkKeyRef.current = normalizedKey;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [deepLinkSettingKey, visibleKeySet]);

  const value = useMemo<SettingsSearchContextValue>(
    () => ({
      query,
      setQuery,
      parsedQuery,
      hasActiveFilters,
      resultCount: visibleEntries.length,
      firstMatch,
      suggestions,
      showAdvanced,
      isAdvancedVisible,
      isAdvancedTokenActive,
      hasVisibleAdvancedEntries,
      toggleShowAdvanced: () => setShowAdvanced((current) => !current),
      clearAdvancedToken,
      applySuggestion,
      isFieldVisible,
      isFieldHighlighted,
      isFieldModified,
      isFieldIdTargeted,
      isAnchorVisible,
      isAdvancedAnchorVisible,
      focusFirstMatch,
    }),
    [
      applySuggestion,
      clearAdvancedToken,
      firstMatch,
      focusFirstMatch,
      hasActiveFilters,
      hasVisibleAdvancedEntries,
      isAdvancedTokenActive,
      isAdvancedVisible,
      isAdvancedAnchorVisible,
      isAnchorVisible,
      isFieldHighlighted,
      isFieldIdTargeted,
      isFieldModified,
      isFieldVisible,
      parsedQuery,
      query,
      showAdvanced,
      suggestions,
      visibleEntries.length,
    ],
  );

  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

export function useSettingsSearch(): SettingsSearchContextValue {
  const context = useContext(SettingsSearchContext);
  if (!context) {
    throw new Error("useSettingsSearch must be used within <SettingsSearchProvider>");
  }
  return context;
}

export function useOptionalSettingsSearch(): SettingsSearchContextValue | null {
  return useContext(SettingsSearchContext);
}
