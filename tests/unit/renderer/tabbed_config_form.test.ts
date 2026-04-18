import {
  buildNamingPreviewConfig,
  NAMING_TEMPLATE_DESCRIPTION,
  NamingSection,
} from "@renderer/components/config-form/TabbedConfigForm";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FieldValues, FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

function NamingSectionHarness() {
  const form = useForm<FieldValues>({
    defaultValues: {
      naming: {
        folderTemplate: "{actor}/{number}",
        fileTemplate: "{number}",
      },
    },
  });

  return createElement(
    FormProvider,
    form as ComponentProps<typeof FormProvider>,
    createElement(NamingSection, { siteOptions: [] }),
  );
}

describe("TabbedConfigForm", () => {
  it("renders naming template placeholder help for both template fields", () => {
    const html = renderToStaticMarkup(createElement(NamingSectionHarness));

    expect(html.split(NAMING_TEMPLATE_DESCRIPTION)).toHaveLength(3);
  });

  it("builds nested naming preview config from flat form field values", () => {
    expect(
      buildNamingPreviewConfig({
        "naming.folderTemplate": "{actorFallbackPrefix}{actor}/{number}",
        "naming.fileTemplate": "{number}{originaltitle}",
        "naming.actorFallbackToStudio": true,
        "behavior.successFileMove": true,
        "behavior.successFileRename": true,
      }),
    ).toMatchObject({
      naming: {
        folderTemplate: "{actorFallbackPrefix}{actor}/{number}",
        fileTemplate: "{number}{originaltitle}",
        actorFallbackToStudio: true,
      },
      behavior: {
        successFileMove: true,
        successFileRename: true,
      },
    });
  });
});
