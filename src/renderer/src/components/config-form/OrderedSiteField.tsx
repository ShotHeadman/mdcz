import { ArrowDown, ArrowUp } from "lucide-react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormControl } from "@/components/ui/Form";
import { cn } from "@/lib/utils";

interface OrderedSiteFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
  options: string[];
}

const unique = (values: string[]): string[] => [...new Set(values.filter((value) => value.trim().length > 0))];

export function OrderedSiteField({ field, options }: OrderedSiteFieldProps) {
  const enabledSites = unique(Array.isArray(field.value) ? field.value : []);
  const disabledSites = options.filter((site) => !enabledSites.includes(site));
  const visibleSites = [...enabledSites, ...disabledSites];

  const setEnabledSites = (sites: string[]) => {
    field.onChange(unique(sites));
  };

  const toggleSite = (site: string, enabled: boolean) => {
    if (enabled) {
      setEnabledSites([...enabledSites, site]);
      return;
    }

    setEnabledSites(enabledSites.filter((candidate) => candidate !== site));
  };

  const moveSite = (site: string, direction: -1 | 1) => {
    const index = enabledSites.indexOf(site);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= enabledSites.length) {
      return;
    }

    const nextSites = [...enabledSites];
    [nextSites[index], nextSites[nextIndex]] = [nextSites[nextIndex], nextSites[index]];
    setEnabledSites(nextSites);
  };

  return (
    <FormControl>
      <div className="rounded-md border bg-background divide-y">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="mr-auto">
            已启用 {enabledSites.length}/{options.length}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setEnabledSites(options)}>
            全选
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => setEnabledSites([])}>
            全不选
          </Button>
        </div>

        {visibleSites.map((site) => {
          const enabled = enabledSites.includes(site);
          const enabledIndex = enabledSites.indexOf(site);
          return (
            <div
              key={site}
              className={cn(
                "grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm",
                !enabled && "text-muted-foreground",
              )}
            >
              <Checkbox checked={enabled} onCheckedChange={(checked) => toggleSite(site, checked === true)} />
              <span className="font-mono text-xs">{site}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!enabled || enabledIndex <= 0}
                  onClick={() => moveSite(site, -1)}
                  aria-label={`上移 ${site}`}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!enabled || enabledIndex < 0 || enabledIndex >= enabledSites.length - 1}
                  onClick={() => moveSite(site, 1)}
                  aria-label={`下移 ${site}`}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </FormControl>
  );
}
