export interface FormatBytesOptions {
  fractionDigits?: number;
  trimTrailingZeros?: boolean;
}

export const formatBytes = (bytes: number, options: FormatBytesOptions = {}): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 ? 0 : Math.max(0, Math.trunc(options.fractionDigits ?? 1));
  const formatted = value.toFixed(fractionDigits);
  const displayValue = options.trimTrailingZeros ? formatted.replace(/\.0+$/u, "") : formatted;

  return `${displayValue} ${units[unitIndex]}`;
};
