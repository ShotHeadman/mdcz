import { SectionAnchor } from "@renderer/components/settings/SectionAnchor";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

function DeferredSectionHarness() {
  const props = {
    id: "custom",
    label: "Custom",
    title: "Custom",
    deferContent: true,
    estimatedContentHeight: 320,
  } satisfies Omit<ComponentProps<typeof SectionAnchor>, "children">;

  return createElement(
    SectionAnchor,
    props as ComponentProps<typeof SectionAnchor>,
    createElement("div", null, "Deferred content"),
  );
}

function ImmediateSectionHarness() {
  const sectionProps = {
    id: "custom-immediate",
    label: "Custom Immediate",
    title: "Custom Immediate",
  } satisfies Omit<ComponentProps<typeof SectionAnchor>, "children">;

  return createElement(
    SectionAnchor,
    sectionProps as ComponentProps<typeof SectionAnchor>,
    createElement("div", null, "Immediate content"),
  );
}

function ForceOpenSectionHarness() {
  const sectionProps = {
    id: "custom-force-open",
    label: "Custom Force Open",
    title: "Custom Force Open",
    deferContent: true,
    forceOpen: true,
    estimatedContentHeight: 320,
  } satisfies Omit<ComponentProps<typeof SectionAnchor>, "children">;

  return createElement(
    SectionAnchor,
    sectionProps as ComponentProps<typeof SectionAnchor>,
    createElement("div", null, "Force-open content"),
  );
}

describe("SectionAnchor", () => {
  it("renders a placeholder before deferred section content is activated", () => {
    const html = renderToStaticMarkup(createElement(DeferredSectionHarness));

    expect(html).toContain('data-deferred-placeholder="true"');
    expect(html).not.toContain("Deferred content");
  });

  it("renders non-deferred section content immediately", () => {
    const html = renderToStaticMarkup(createElement(ImmediateSectionHarness));

    expect(html).toContain("Immediate content");
    expect(html).not.toContain('data-deferred-placeholder="true"');
  });

  it("renders deferred section content immediately when force-opened", () => {
    const html = renderToStaticMarkup(createElement(ForceOpenSectionHarness));

    expect(html).toContain("Force-open content");
    expect(html).not.toContain('data-deferred-placeholder="true"');
  });
});
