export interface SkeletonNavItem {
  label: string;
  status: "placeholder";
}

export const getSkeletonNavItems = (): SkeletonNavItem[] => [
  { label: "Overview", status: "placeholder" },
  { label: "Media roots", status: "placeholder" },
  { label: "File browser", status: "placeholder" },
  { label: "Tasks", status: "placeholder" },
  { label: "Settings", status: "placeholder" },
];
