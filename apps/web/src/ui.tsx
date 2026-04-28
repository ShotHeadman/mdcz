import type { ComponentProps, PropsWithChildren, ReactNode } from "react";

import { Badge as DesktopBadge } from "@/components/ui/Badge";
import { Button as DesktopButton } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input as DesktopInput } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export const Button = ({
  children,
  className,
  variant = "primary",
  type = "button",
  ...props
}: PropsWithChildren<{
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  className?: string;
}>) => (
  <DesktopButton
    className={className}
    variant={variant === "danger" ? "destructive" : variant === "secondary" ? "secondary" : "default"}
    type={type}
    {...props}
  >
    {children}
  </DesktopButton>
);

export const Panel = ({
  title,
  description,
  children,
  className,
}: PropsWithChildren<{ title?: ReactNode; description?: ReactNode; className?: string }>) => (
  <Card className={cn("gap-5", className)}>
    {(title || description) && (
      <CardHeader>
        {title && <CardTitle>{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
    )}
    <CardContent className="space-y-4">{children}</CardContent>
  </Card>
);

export const Field = ({ label, children }: PropsWithChildren<{ label: string }>) => (
  <div className="grid gap-2 text-sm font-medium text-foreground">
    <span>{label}</span>
    {children}
  </div>
);

export const Input = (props: ComponentProps<typeof DesktopInput>) => <DesktopInput {...props} />;

export const Badge = ({ className, ...props }: ComponentProps<typeof DesktopBadge>) => (
  <DesktopBadge className={className} variant="outline" {...props} />
);

export const Page = ({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: ReactNode }>) => (
  <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
    <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MDCz WebUI alpha</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <div className="mt-3 text-sm leading-6 text-muted-foreground">{subtitle}</div>}
      </header>
      {children}
    </div>
  </main>
);
