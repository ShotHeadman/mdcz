import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/Form";
import { SettingsEditorAutosaveProvider, valuesEqual } from "@/hooks/useAutoSaveField";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsSearchProvider } from "./SettingsSearchContext";
import { flattenConfig } from "./settingsRegistry";

const loadSettingsForm = () => import("./SettingsForm");

const LazySettingsForm = lazy(async () => {
  const module = await loadSettingsForm();
  return { default: module.SettingsForm };
});

export function preloadSettingsEditorBody() {
  void loadSettingsForm();
}

interface SettingsEditorProps {
  data: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  defaultConfigReady?: boolean;
  deepLinkSettingKey?: string | null;
  profiles: string[];
  activeProfile: string | null;
  profileLoading?: boolean;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  onExportProfile: () => void;
  onImportProfile: () => void;
}

export function SettingsEditor({
  data,
  defaultConfig = {},
  defaultConfigReady = false,
  deepLinkSettingKey = null,
  profiles,
  activeProfile,
  profileLoading = false,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
}: SettingsEditorProps) {
  const flatConfigValues = useMemo(() => flattenConfig(data), [data]);
  const flatDefaultValues = useMemo(() => flattenConfig(defaultConfig), [defaultConfig]);
  const initialUseCustomTitleBarRef = useRef<boolean | null>(null);

  if (initialUseCustomTitleBarRef.current === null) {
    initialUseCustomTitleBarRef.current = Boolean(flatConfigValues["ui.useCustomTitleBar"] ?? true);
  }

  const form = useForm<FieldValues>({
    defaultValues: flatConfigValues,
    mode: "onChange",
  });

  useEffect(() => {
    if (valuesEqual(form.getValues(), flatConfigValues)) {
      return;
    }

    form.reset(flatConfigValues);
  }, [flatConfigValues, form]);

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="h-full"
      >
        <SettingsEditorAutosaveProvider
          savedValues={flatConfigValues}
          defaultValues={flatDefaultValues}
          defaultValuesReady={defaultConfigReady}
        >
          <SettingsSearchProvider
            defaultConfig={defaultConfig}
            defaultConfigReady={defaultConfigReady}
            deepLinkSettingKey={deepLinkSettingKey}
          >
            <SettingsLayout
              profiles={profiles}
              activeProfile={activeProfile}
              profileLoading={profileLoading}
              onSwitchProfile={onSwitchProfile}
              onCreateProfile={onCreateProfile}
              onDeleteProfile={onDeleteProfile}
              onResetConfig={onResetConfig}
              onExportProfile={onExportProfile}
              onImportProfile={onImportProfile}
            >
              <Suspense fallback={<SettingsFormSkeleton />}>
                <LazySettingsForm
                  flatDefaults={flatConfigValues}
                  initialUseCustomTitleBar={initialUseCustomTitleBarRef.current ?? true}
                />
              </Suspense>
            </SettingsLayout>
          </SettingsSearchProvider>
        </SettingsEditorAutosaveProvider>
      </form>
    </Form>
  );
}

function SettingsFormSkeleton() {
  const sectionKeys = ["section-a", "section-b", "section-c", "section-d"];
  const rowKeys = ["row-a", "row-b", "row-c", "row-d"];

  return (
    <div className="space-y-10">
      {sectionKeys.map((sectionKey) => (
        <section key={sectionKey} className="space-y-4">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded-full bg-foreground/8" />
            <div className="h-4 w-72 animate-pulse rounded-full bg-foreground/6" />
          </div>
          <div className="space-y-3 rounded-[var(--radius-quiet-xl)] border border-border/30 bg-surface px-5 py-5">
            {rowKeys.map((rowKey) => (
              <div
                key={`${sectionKey}-${rowKey}`}
                className="flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-2">
                  <div className="h-4 w-36 animate-pulse rounded-full bg-foreground/8" />
                  <div className="h-3 w-56 animate-pulse rounded-full bg-foreground/6" />
                </div>
                <div className="h-8 w-48 animate-pulse rounded-[var(--radius-quiet)] bg-surface-low" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
