/**
 * 去重字符串数组：对每个元素 trim，过滤空字符串，再 Set 去重。
 */
export const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const cleaned = values.map((v) => v?.trim() ?? "").filter((v) => v.length > 0);
  return Array.from(new Set(cleaned));
};
