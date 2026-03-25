import {
  buildMultipartDisplayGroups,
  type MultipartDisplayGroup,
  type MultipartDisplaySelectors,
} from "@/lib/multipartDisplay";

export type RendererGroupStatus = "success" | "failed" | "processing" | "idle";

export interface RendererGroup<TItem, TDisplay = TItem, TStatus extends string = RendererGroupStatus> {
  id: string;
  representative: TItem;
  items: TItem[];
  display: TDisplay;
  status: TStatus;
  errorText?: string;
}

interface BuildRendererGroupsOptions<TItem, TDisplay, TStatus extends string> {
  selectors: MultipartDisplaySelectors<TItem>;
  buildDisplay?: (group: MultipartDisplayGroup<TItem>) => TDisplay;
  buildStatus: (group: MultipartDisplayGroup<TItem>, display: TDisplay) => TStatus;
  buildErrorText?: (group: MultipartDisplayGroup<TItem>, display: TDisplay) => string | undefined;
}

export const buildRendererGroups = <TItem, TDisplay = TItem, TStatus extends string = RendererGroupStatus>(
  items: TItem[],
  options: BuildRendererGroupsOptions<TItem, TDisplay, TStatus>,
): RendererGroup<TItem, TDisplay, TStatus>[] => {
  return buildMultipartDisplayGroups(items, options.selectors).map((group) => {
    const representative = group.representative;
    const display = options.buildDisplay ? options.buildDisplay(group) : (representative as unknown as TDisplay);

    return {
      id: group.key,
      representative,
      items: group.items,
      display,
      status: options.buildStatus(group, display),
      errorText: options.buildErrorText?.(group, display),
    };
  });
};

export const findRendererGroup = <TGroup extends RendererGroup<unknown, unknown, string>>(
  groups: TGroup[],
  id: string | null | undefined,
  getItemId?: (item: TGroup["items"][number]) => string,
): TGroup | undefined => {
  if (!id) {
    return undefined;
  }

  return groups.find(
    (group) => group.id === id || (getItemId ? group.items.some((item) => getItemId(item) === id) : false),
  );
};
