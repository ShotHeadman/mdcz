export type LocalPathStyle = "windows" | "posix";

export const localPathStyle = (value: string): LocalPathStyle | undefined => {
  if (/^[a-z]:[\\/]/iu.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(value)) return "windows";
  if (value.startsWith("/") && !value.startsWith("//")) return "posix";
  return undefined;
};

export const localPathPrefixKey = (value: string): string => {
  const style = localPathStyle(value);
  const normalized = (style === "windows" ? value.replaceAll("\\", "/").toLowerCase() : value)
    .replace(/\/{2,}/gu, "/")
    .replace(/\/+$/u, "");
  return normalized || "/";
};

export const isLocalAbsolutePrefix = (value: string): boolean => {
  const style = localPathStyle(value);
  if (!style || [...value].some((character) => character.charCodeAt(0) < 32)) return false;
  const segments = value.split(style === "windows" ? /[\\/]/u : /\//u);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  return (
    style !== "windows" ||
    (!/[<>"|?*:]/u.test(value.replace(/^[a-z]:/iu, "")) && !segments.some((segment) => /[. ]$/u.test(segment)))
  );
};
