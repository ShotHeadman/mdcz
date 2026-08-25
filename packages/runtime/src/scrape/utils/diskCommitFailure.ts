const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const formatDiskCommitFailure = (error: unknown): string =>
  `文件操作已完成，但媒体库提交失败：${errorMessage(error)}。请重新扫描，以磁盘实际状态重新协调。`;
