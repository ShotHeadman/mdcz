import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CrossFieldBanner } from "@/components/settings/CrossFieldBanner";
import { useOptionalSettingsSearch } from "@/components/settings/SettingsSearchContext";
import { type FieldEntry, SECTION_LABELS } from "@/components/settings/settingsRegistry";
import { useCrossFieldErrors } from "@/hooks/useCrossFieldErrors";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/Collapsible";
import { useOptionalToc } from "./TocContext";

interface SectionAnchorProps {
  id: string;
  label: string;
  title?: string;
  description?: string;
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  deferContent?: boolean;
  estimatedContentHeight?: number;
  children: ReactNode;
}

function isKnownAnchor(id: string): id is FieldEntry["anchor"] {
  return id in SECTION_LABELS;
}

export function SectionAnchor({
  id,
  label,
  title,
  description,
  className,
  defaultOpen = true,
  forceOpen = false,
  deferContent = false,
  estimatedContentHeight = 480,
  children,
}: SectionAnchorProps) {
  const toc = useOptionalToc();
  const search = useOptionalSettingsSearch();
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRef<HTMLElement | null>(null);
  const shouldForceOpen = forceOpen || Boolean(search?.hasActiveFilters);
  const resolvedOpen = shouldForceOpen || open;
  const hiddenBySearch = isKnownAnchor(id) && search ? !search.isAnchorVisible(id) : false;
  const registerSection = toc?.register;
  const shouldDeferContent = deferContent && !shouldForceOpen;
  const [contentReady, setContentReady] = useState(() => !shouldDeferContent);

  useEffect(() => {
    if (hiddenBySearch || !registerSection) {
      return;
    }
    return registerSection({ id, label });
  }, [hiddenBySearch, id, label, registerSection]);

  useEffect(() => {
    if (!shouldDeferContent) {
      if (!contentReady) {
        setContentReady(true);
      }
      return;
    }

    if (contentReady) {
      return;
    }

    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setContentReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setContentReady(true);
          observer.disconnect();
        }
      },
      {
        root: toc?.scrollContainerRef.current ?? null,
        rootMargin: "420px 0px",
      },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [contentReady, shouldDeferContent, toc?.scrollContainerRef]);

  if (hiddenBySearch) {
    return null;
  }

  return (
    <section ref={sectionRef} data-toc-id={id} id={`settings-${id}`} className={cn("scroll-mt-28", className)}>
      <Collapsible open={resolvedOpen} onOpenChange={setOpen}>
        {(title || description) && (
          <header className="mb-4">
            <CollapsibleTrigger className="group flex w-full items-start gap-4 rounded-[var(--radius-quiet-lg)] py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/20">
              <span className="min-w-0 flex-1">
                {title && (
                  <span className="block font-numeric text-[1.5rem] font-bold tracking-[-0.03em] text-foreground md:text-[1.75rem]">
                    {title}
                  </span>
                )}
                {description && (
                  <span className="mt-1.5 block max-w-prose text-sm leading-6 text-muted-foreground">
                    {description}
                  </span>
                )}
              </span>
              <span className="mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-surface-low text-muted-foreground transition-colors group-hover:bg-surface-raised group-hover:text-foreground">
                <ChevronDown
                  className={cn("size-4 transition-transform duration-200", resolvedOpen ? "rotate-0" : "-rotate-90")}
                />
              </span>
            </CollapsibleTrigger>
          </header>
        )}
        {isKnownAnchor(id) && <SectionBanner sectionKey={id} />}
        <CollapsibleContent className="data-[state=closed]:animate-none data-[state=open]:animate-none">
          {contentReady ? (
            <div className="space-y-1">{children}</div>
          ) : (
            <DeferredSectionPlaceholder estimatedContentHeight={estimatedContentHeight} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function SectionBanner({ sectionKey }: { sectionKey: FieldEntry["anchor"] }) {
  const errors = useCrossFieldErrors(sectionKey);
  return <CrossFieldBanner errors={errors} />;
}

function DeferredSectionPlaceholder({ estimatedContentHeight }: { estimatedContentHeight: number }) {
  return (
    <div
      data-deferred-placeholder="true"
      aria-hidden="true"
      className="overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/35 bg-surface/70 px-5 py-5"
      style={{ minHeight: estimatedContentHeight }}
    >
      <div className="space-y-4">
        <div className="h-4 w-36 animate-pulse rounded-full bg-foreground/8" />
        <div className="space-y-3">
          <div className="h-10 rounded-[var(--radius-quiet-lg)] bg-surface-low/80" />
          <div className="h-10 rounded-[var(--radius-quiet-lg)] bg-surface-low/70" />
          <div className="h-10 rounded-[var(--radius-quiet-lg)] bg-surface-low/60" />
        </div>
      </div>
    </div>
  );
}
