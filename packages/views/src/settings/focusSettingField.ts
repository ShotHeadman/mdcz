const PRIMARY_FOCUSABLE_SELECTOR =
  "input:not([type=hidden]), textarea, select, [role='combobox'], [data-slot='switch'], [data-slot='select-trigger']";
const SECONDARY_FOCUSABLE_SELECTOR = "button, [role='button'], [tabindex]:not([tabindex='-1'])";

export function focusSettingFieldElement(element: HTMLElement): boolean {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const searchRoot = element.querySelector<HTMLElement>("[data-setting-control]") ?? element;
  const focusable =
    searchRoot.querySelector<HTMLElement>(PRIMARY_FOCUSABLE_SELECTOR) ??
    searchRoot.querySelector<HTMLElement>(SECONDARY_FOCUSABLE_SELECTOR);
  focusable?.focus();
  return true;
}

export function focusSettingFieldInDom(field: string): boolean {
  const selector = `[data-field-name="${CSS.escape(field)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return false;
  }

  return focusSettingFieldElement(element);
}
