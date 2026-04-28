import type { NfoLocalState, UncensoredChoice } from "@mdcz/shared/types";

const UNCENSORED_CHOICE_TAGS: Record<UncensoredChoice, string> = {
  umr: "破解",
  leak: "流出",
  uncensored: "无码",
};

const UNCENSORED_TAG_CHOICES = new Map(
  Object.entries(UNCENSORED_CHOICE_TAGS).map(([choice, tag]) => [tag, choice as UncensoredChoice]),
);

export const uncensoredChoiceToTag = (choice: UncensoredChoice | undefined): string | undefined => {
  return choice ? UNCENSORED_CHOICE_TAGS[choice] : undefined;
};

export const tagToUncensoredChoice = (tag: string): UncensoredChoice | undefined => {
  return UNCENSORED_TAG_CHOICES.get(tag.trim());
};

export const normalizeNfoLocalState = (localState: NfoLocalState | undefined): NfoLocalState | undefined => {
  if (!localState) {
    return undefined;
  }

  const tags = Array.from(
    new Set((localState.tags ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  );

  if (!localState.uncensoredChoice && tags.length === 0) {
    return undefined;
  }

  return {
    uncensoredChoice: localState.uncensoredChoice,
    tags: tags.length > 0 ? tags : undefined,
  };
};
