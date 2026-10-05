import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface TocSection {
  id: string;
  label: string;
}

interface TocContextValue {
  sections: TocSection[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  register: (section: TocSection) => () => void;
  scrollToSection: (id: string, behavior: ScrollBehavior) => void;
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
  const releasePinRef = useRef<(() => void) | null>(null);

  const register = useCallback((section: TocSection) => {
    setSections((prev) => {
      if (prev.some((s) => s.id === section.id)) return prev;
      return [...prev, section];
    });
    return () => {
      setSections((prev) => prev.filter((s) => s.id !== section.id));
    };
  }, []);

  const scrollToSection = useCallback(
    (id: string, behavior: ScrollBehavior) => {
      releasePinRef.current?.();
      const container = scrollContainerRef.current;
      const content = container?.firstElementChild;
      const target = container?.querySelector(`[data-toc-id="${id}"]`);
      if (!container || !content || !target) return;
      // Deferred sections swap their estimated height for real content as the scroll passes them, so keep the
      // target pinned on every layout change until the user takes over.
      const observer = new ResizeObserver(() =>
        container.scrollBy({
          top: target.getBoundingClientRect().top - container.getBoundingClientRect().top - 24,
          behavior,
        }),
      );
      const release = new AbortController();
      releasePinRef.current = () => {
        observer.disconnect();
        release.abort();
        releasePinRef.current = null;
      };
      observer.observe(content);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        window.addEventListener(type, () => releasePinRef.current?.(), { capture: true, signal: release.signal });
      }
    },
    [scrollContainerRef],
  );

  useEffect(() => () => releasePinRef.current?.(), []);

  const value = useMemo<TocContextValue>(
    () => ({ sections, activeId, setActiveId, register, scrollToSection, scrollContainerRef }),
    [sections, activeId, register, scrollToSection, scrollContainerRef],
  );

  return <TocContext.Provider value={value}>{children}</TocContext.Provider>;
}

export function useOptionalToc(): TocContextValue | null {
  return useContext(TocContext);
}
