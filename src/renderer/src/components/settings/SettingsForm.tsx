import { useEffect, useMemo, useRef } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm } from "react-hook-form";
import { Form, flattenConfig, useCrawlerSiteOptions } from "./settingsContent";
import {
  DataSourcesSection,
  ExtractionRulesSection,
  PathsTopLevelSection,
  RateLimitingSection,
  SystemTopLevelSection,
} from "./TopLevelSections";

interface SettingsFormProps {
  data: Record<string, unknown>;
}

export function SettingsForm({ data }: SettingsFormProps) {
  const flatDefaults = useMemo(() => flattenConfig(data), [data]);
  const initialUseCustomTitleBarRef = useRef<boolean | null>(null);

  if (initialUseCustomTitleBarRef.current === null) {
    initialUseCustomTitleBarRef.current = Boolean(flatDefaults["ui.useCustomTitleBar"] ?? true);
  }

  const form = useForm<FieldValues>({
    defaultValues: flatDefaults,
    mode: "onChange",
  });

  useEffect(() => {
    form.reset(flatDefaults);
  }, [flatDefaults, form]);

  const siteOptions = useCrawlerSiteOptions(flatDefaults);
  const initialUseCustomTitleBar = initialUseCustomTitleBarRef.current ?? true;

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="space-y-12"
      >
        <DataSourcesSection siteOptions={siteOptions} />
        <RateLimitingSection />
        <ExtractionRulesSection />
        <PathsTopLevelSection />
        <SystemTopLevelSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
      </form>
    </Form>
  );
}
