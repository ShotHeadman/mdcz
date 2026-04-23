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
import { focusSettingFieldElement, focusSettingFieldInDom } from "./focusSettingField";
import { buildSettingsBrowseState } from "./settingsBrowseState";
import type { SettingsDeepLinkSectionId } from "./settingsDeepLink";
import { getSettingsSuggestions, replaceLastToken, type SettingsSuggestion, valuesEqual } from "./settingsFilter";
import { FIELD_KEYS, type FieldAnchor, type FieldEntry, flattenConfig } from "./settingsRegistry";

interface SettingsSearchContextValue {
  query: string;
  setQuery: (value: string) => void;
  parsedQuery: ReturnType<typeof buildSettingsBrowseState>["parsedQuery"];
  hasActiveFilters: boolean;
  resultCount: number;
  firstMatch: FieldEntry | null;
  suggestions: SettingsSuggestion[];
  isAdvancedVisible: boolean;
  hasVisibleAdvancedEntries: boolean;
  toggleShowAdvanced: () => void;
  applySuggestion: (suggestion: SettingsSuggestion) => void;
  isFieldVisible: (key: string) => boolean;
  isFieldHighlighted: (key: string) => boolean;
  isFieldModified: (key: string) => boolean;
  isAnchorVisible: (anchor: FieldAnchor) => boolean;
  isAdvancedAnchorVisible: (anchor: FieldAnchor) => boolean;
  isSectionForceOpen: (sectionId: SettingsDeepLinkSectionId) => boolean;
  focusFirstMatch: () => void;
  registerFieldNode: (key: string, node: HTMLElement | null) => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

interface SettingsSearchProviderProps {
  children: ReactNode;
  defaultConfig: Record<string, unknown>;
  defaultConfigReady?: boolean;
  deepLinkSettingKey?: string | null;
}

export function SettingsSearchProvider({
  children,
  defaultConfig,
  defaultConfigReady = false,
  deepLinkSettingKey = null,
}: SettingsSearchProviderProps) {
  const form = useFormContext<FieldValues>();
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const fieldNodesRef = useRef(new Map<string, HTMLElement>());
  const focusedTargetFieldKeyRef = useRef<string | null>(null);
  const watchedValues = useWatch({
    control: form.control,
    name: FIELD_KEYS,
  }) as unknown[];

  const defaultValues = useMemo(() => flattenConfig(defaultConfig), [defaultConfig]);
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

  const browseState = useMemo(
    () =>
      buildSettingsBrowseState({
        query: deferredQuery,
        showAdvanced,
        modifiedKeys,
        deepLinkSettingKey,
      }),
    [deepLinkSettingKey, deferredQuery, modifiedKeys, showAdvanced],
  );
  const {
    parsedQuery,
    visibleEntries,
    visibleKeySet,
    visiblePublicAnchorSet,
    visibleAdvancedAnchorSet,
    hasActiveFilters,
    isAdvancedVisible,
    hasVisibleAdvancedEntries,
    targetFieldKey,
    targetSectionId,
  } = browseState;
  const firstMatch = visibleEntries[0] ?? null;

  const applySuggestion = useCallback((suggestion: SettingsSuggestion) => {
    setQuery((previous) => replaceLastToken(previous, suggestion.insertValue));
  }, []);

  const focusRegisteredField = useCallback((key: string) => {
    const node = fieldNodesRef.current.get(key);
    if (node) {
      return focusSettingFieldElement(node);
    }

    return focusSettingFieldInDom(key);
  }, []);

  const focusFirstMatch = useCallback(() => {
    for (const entry of visibleEntries) {
      if (focusRegisteredField(entry.key)) {
        return;
      }
    }
  }, [focusRegisteredField, visibleEntries]);

  const registerFieldNode = useCallback(
    (key: string, node: HTMLElement | null) => {
      const nodes = fieldNodesRef.current;
      if (!node) {
        nodes.delete(key);
        return;
      }

      nodes.set(key, node);
      if (key === targetFieldKey && visibleKeySet.has(key) && focusedTargetFieldKeyRef.current !== key) {
        if (focusSettingFieldElement(node)) {
          focusedTargetFieldKeyRef.current = key;
        }
      }
    },
    [targetFieldKey, visibleKeySet],
  );

  useEffect(() => {
    if (!targetFieldKey) {
      focusedTargetFieldKeyRef.current = null;
      return;
    }

    if (focusedTargetFieldKeyRef.current === targetFieldKey || !visibleKeySet.has(targetFieldKey)) {
      return;
    }

    const node = fieldNodesRef.current.get(targetFieldKey);
    if (node && focusSettingFieldElement(node)) {
      focusedTargetFieldKeyRef.current = targetFieldKey;
    }
  }, [targetFieldKey, visibleKeySet]);

  const isFieldVisible = useCallback((key: string) => visibleKeySet.has(key), [visibleKeySet]);
  const isFieldHighlighted = useCallback(
    (key: string) => hasActiveFilters && visibleKeySet.has(key),
    [hasActiveFilters, visibleKeySet],
  );
  const isFieldModified = useCallback((key: string) => modifiedKeys.has(key), [modifiedKeys]);
  const isAnchorVisible = useCallback(
    (anchor: FieldAnchor) => visiblePublicAnchorSet.has(anchor),
    [visiblePublicAnchorSet],
  );
  const isAdvancedAnchorVisible = useCallback(
    (anchor: FieldAnchor) => visibleAdvancedAnchorSet.has(anchor),
    [visibleAdvancedAnchorSet],
  );
  const isSectionForceOpen = useCallback(
    (sectionId: SettingsDeepLinkSectionId) => targetSectionId === sectionId,
    [targetSectionId],
  );

  const value = useMemo<SettingsSearchContextValue>(
    () => ({
      query,
      setQuery,
      parsedQuery,
      hasActiveFilters,
      resultCount: visibleEntries.length,
      firstMatch,
      suggestions,
      isAdvancedVisible,
      hasVisibleAdvancedEntries,
      toggleShowAdvanced: () => setShowAdvanced((current) => !current),
      applySuggestion,
      isFieldVisible,
      isFieldHighlighted,
      isFieldModified,
      isAnchorVisible,
      isAdvancedAnchorVisible,
      isSectionForceOpen,
      focusFirstMatch,
      registerFieldNode,
    }),
    [
      applySuggestion,
      firstMatch,
      focusFirstMatch,
      hasActiveFilters,
      hasVisibleAdvancedEntries,
      isAdvancedVisible,
      isAdvancedAnchorVisible,
      isAnchorVisible,
      isFieldHighlighted,
      isFieldModified,
      isFieldVisible,
      isSectionForceOpen,
      parsedQuery,
      query,
      registerFieldNode,
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
