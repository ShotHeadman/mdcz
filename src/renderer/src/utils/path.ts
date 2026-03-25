export const getDirFromPath = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) {
    return filePath;
  }

  return filePath.slice(0, slash);
};
