import { cn } from "@mdcz/ui";
import type { ReactNode } from "react";

interface SubsectionProps {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

export function Subsection({ title, description, className, children }: SubsectionProps) {
  return (
    <section className={cn("space-y-2 mb-8 last:mb-0", className)}>
      <header className="pb-1">
        <h3 className="font-numeric text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
