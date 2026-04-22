import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useToc } from "./TocContext";
import { useScrollSpy } from "./useScrollSpy";

interface FloatingTocProps {
  className?: string;
}

export function FloatingToc({ className }: FloatingTocProps) {
  const { sections, activeId, setActiveId, scrollContainerRef } = useToc();
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(null);

  useScrollSpy({
    sections,
    scrollContainer: scrollContainerRef.current,
    onActiveChange: setActiveId,
  });

  useEffect(() => {
    if (optimisticActiveId && optimisticActiveId === activeId) {
      setOptimisticActiveId(null);
    }
  }, [optimisticActiveId, activeId]);

  if (sections.length === 0) return null;

  const handleClick = (id: string) => {
    setOptimisticActiveId(id);
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-toc-id="${id}"]`);
    if (!el) return;
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    container.scrollBy({ top: elTop - containerTop - 24, behavior: "smooth" });
  };

  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        "sticky top-24 ml-8 hidden w-48 shrink-0 self-start border-l border-border/50 pl-4 lg:block",
        className,
      )}
    >
      <ul className="space-y-3 text-sm">
        {sections.map((section) => {
          const isActive = section.id === (optimisticActiveId ?? activeId);
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => handleClick(section.id)}
                className={cn(
                  "relative block w-full pl-4 text-left text-[15px] transition-colors outline-none focus-visible:text-foreground",
                  "before:absolute before:left-0 before:top-1/2 before:h-7 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-foreground before:transition-opacity",
                  isActive
                    ? "font-semibold text-foreground before:opacity-100"
                    : "font-medium text-muted-foreground before:opacity-0 hover:text-foreground",
                )}
              >
                {section.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
