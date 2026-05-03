export const isAbsolutePath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);

export const joinPath = (base: string, child: string): string => {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/u, "")}${separator}${child.replace(/^[\\/]+/u, "")}`;
};

export const resolveSuccessTargetDir = (scanDir: string, successOutputFolder: string | undefined): string => {
  const target = successOutputFolder?.trim() ?? "";
  if (!target) {
    return "";
  }
  if (isAbsolutePath(target) || !scanDir.trim()) {
    return target;
  }
  return joinPath(scanDir, target);
};
