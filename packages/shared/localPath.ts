export type LocalPathStyle = "windows" | "posix";

export const localPathStyle = (value: string): LocalPathStyle | undefined => {
  if (/^[a-z]:[\\/]/iu.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(value)) return "windows";
  if (value.startsWith("/") && !value.startsWith("//")) return "posix";
  return undefined;
};
