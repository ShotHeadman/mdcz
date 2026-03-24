import { useEffect, useMemo, useState } from "react";
import { ipc } from "@/client/ipc";
import { getImageSrc, getLocalImagePath, resolveImagePath } from "@/utils/image";

const dedupeValues = (values: string[]): string[] => {
  return values.filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);
};

export function useResolvedImageCandidates(rawCandidates: string[], baseDir?: string): string[] {
  const candidateKey = rawCandidates.map((candidate) => candidate.trim()).join("\u0000");
  const candidates = useMemo(() => (candidateKey ? dedupeValues(candidateKey.split("\u0000")) : []), [candidateKey]);
  const [resolvedCandidates, setResolvedCandidates] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const resolveCandidates = async () => {
      const nextCandidates = dedupeValues(
        await Promise.all(
          candidates.map(async (candidate) => {
            const localPath = getLocalImagePath(candidate, baseDir);
            if (localPath) {
              try {
                const { exists } = await ipc.file.exists(localPath);
                return exists ? getImageSrc(localPath) : "";
              } catch {
                return "";
              }
            }

            return getImageSrc(resolveImagePath(candidate, baseDir));
          }),
        ),
      );

      if (!cancelled) {
        setResolvedCandidates(nextCandidates);
      }
    };

    void resolveCandidates();

    return () => {
      cancelled = true;
    };
  }, [baseDir, candidates]);

  return resolvedCandidates;
}

export function useResolvedImageSrc(rawCandidates: string[], baseDir?: string): string {
  const candidates = useResolvedImageCandidates(rawCandidates, baseDir);
  return candidates[0] ?? "";
}
