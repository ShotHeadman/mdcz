import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SubsectionProps {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

export function Subsection({ title, description, className, children }: SubsectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <header>
        <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
