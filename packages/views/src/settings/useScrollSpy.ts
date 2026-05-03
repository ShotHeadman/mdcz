import { useEffect } from "react";
import type { TocSection } from "./TocContext";

interface UseScrollSpyOptions {
  sections: TocSection[];
  scrollContainer: HTMLElement | null;
  onActiveChange: (id: string | null) => void;
  topOffset?: number;
}

export function useScrollSpy({
  sections,
  scrollContainer,
  onActiveChange,
  topOffset = 120,
}: UseScrollSpyOptions): void {
  useEffect(() => {
    if (!scrollContainer || sections.length === 0) {
      onActiveChange(sections[0]?.id ?? null);
      return;
    }

    let frame: number | null = null;

    const compute = () => {
      frame = null;
      const containerRect = scrollContainer.getBoundingClientRect();
      let current: string | null = sections[0]?.id ?? null;

      for (const section of sections) {
        const el = scrollContainer.querySelector<HTMLElement>(`[data-toc-id="${section.id}"]`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top - containerRect.top <= topOffset) {
          current = section.id;
        } else {
          break;
        }
      }

      onActiveChange(current);
    };

    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(compute);
    };

    compute();
    scrollContainer.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      scrollContainer.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections, scrollContainer, onActiveChange, topOffset]);
}
