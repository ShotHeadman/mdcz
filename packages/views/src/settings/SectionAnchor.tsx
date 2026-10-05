import { Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@mdcz/ui";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CrossFieldBanner } from "./CrossFieldBanner";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { type FieldEntry, isFieldAnchor } from "./settingsRegistry";
import { useOptionalToc } from "./TocContext";
import { useCrossFieldErrors } from "./useCrossFieldErrors";

interface SectionAnchorProps {
  id: string;
  label: string;
  title?: string;
  description?: string;
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}

export function SectionAnchor({
  id,
  label,
  title,
  description,
  className,
  defaultOpen = true,
  forceOpen = false,
  children,
}: SectionAnchorProps) {
  const toc = useOptionalToc();
  const search = useOptionalSettingsSearch();
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRef<HTMLElement | null>(null);
  const shouldForceOpen = forceOpen || Boolean(search?.hasActiveFilters);
  const resolvedOpen = shouldForceOpen || open;
  const hiddenBySearch = isFieldAnchor(id) && search ? !search.isAnchorVisible(id) : false;
  const registerSection = toc?.register;

  useEffect(() => {
    if (hiddenBySearch || !registerSection) {
      return;
    }
    return registerSection({ id, label });
  }, [hiddenBySearch, id, label, registerSection]);

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
        {isFieldAnchor(id) && <SectionBanner sectionKey={id} />}
        <CollapsibleContent className="data-[state=closed]:animate-none data-[state=open]:animate-none">
          <div className="space-y-1">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function SectionBanner({ sectionKey }: { sectionKey: FieldEntry["anchor"] }) {
  const errors = useCrossFieldErrors(sectionKey);
  return <CrossFieldBanner errors={errors} />;
}
