import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface TocSection {
  id: string;
  label: string;
}

interface TocContextValue {
  sections: TocSection[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  register: (section: TocSection) => () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

const TocContext = createContext<TocContextValue | null>(null);

export function useToc(): TocContextValue {
  const ctx = useContext(TocContext);
  if (!ctx) {
    throw new Error("useToc must be used within <TocProvider>");
  }
  return ctx;
}

interface TocProviderProps {
  children: ReactNode;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function TocProvider({ children, scrollContainerRef }: TocProviderProps) {
  const [sections, setSections] = useState<TocSection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const register = useCallback((section: TocSection) => {
    setSections((prev) => {
      if (prev.some((s) => s.id === section.id)) return prev;
      return [...prev, section];
    });
    return () => {
      setSections((prev) => prev.filter((s) => s.id !== section.id));
    };
  }, []);

  const value = useMemo<TocContextValue>(
    () => ({ sections, activeId, setActiveId, register, scrollContainerRef }),
    [sections, activeId, register, scrollContainerRef],
  );

  return <TocContext.Provider value={value}>{children}</TocContext.Provider>;
}

export function useOptionalToc(): TocContextValue | null {
  return useContext(TocContext);
}
