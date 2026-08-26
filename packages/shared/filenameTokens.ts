export const hasLiteralFilenameToken = (fileName: string, tokens: readonly string[]): boolean => {
  if (tokens.length === 0) {
    return false;
  }

  const normalizedFileName = fileName.normalize("NFC").toUpperCase();
  for (const token of tokens) {
    if (!token.trim()) {
      continue;
    }

    if (normalizedFileName.includes(token.normalize("NFC").toUpperCase())) {
      return true;
    }
  }

  return false;
};
