import { buildMovieAssetFileNames, isMovieNfoBaseName } from "@mdcz/shared/assetNaming";
import { toErrorMessage } from "@mdcz/shared/error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { readNfo, updateNfo } from "@/api/manual";
import type { DetailViewItem } from "@/components/detail/types";
import {
  createEmptyEditableNfoData,
  type NfoValidationErrors,
  normalizeEditableNfoData,
  serializeEditableNfoData,
  validateEditableNfoData,
} from "@/components/nfo/nfoEditorModel";
import { useResolvedImageCandidates } from "@/hooks/useResolvedImageSources";
import { buildImageSourceCandidates, buildLocalImageCandidate } from "@/utils/image";
import { getDirFromPath } from "@/utils/path";
import { playMediaPath } from "@/utils/playback";

const getPathBaseName = (path: string | undefined): string => {
  const trimmed = path?.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedPath = trimmed.replace(/[\\/]+$/u, "");
  const separatorIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  const fileName = separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath;
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
};

const resolveMovieBaseName = (item: DetailViewItem | null | undefined): string => {
  const videoBaseName = getPathBaseName(item?.path);
  if (videoBaseName) {
    return videoBaseName;
  }

  const nfoBaseName = getPathBaseName(item?.nfoPath);
  if (nfoBaseName && !isMovieNfoBaseName(nfoBaseName)) {
    return nfoBaseName;
  }

  return item?.number?.trim() ?? "";
};

export function useDetailViewController(item?: DetailViewItem | null) {
  const [nfoOpen, setNfoOpen] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoData, setNfoData] = useState(createEmptyEditableNfoData);
  const [nfoInitialSnapshot, setNfoInitialSnapshot] = useState("");
  const [nfoValidationErrors, setNfoValidationErrors] = useState<NfoValidationErrors>({});
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const [posterSrc, setPosterSrc] = useState("");
  const [thumbSrc, setThumbSrc] = useState("");
  const [posterCandidateIndex, setPosterCandidateIndex] = useState(0);
  const [thumbCandidateIndex, setThumbCandidateIndex] = useState(0);
  const assetBasePath = item?.path ?? item?.nfoPath;
  const movieAssetFileNames = useMemo(
    () => buildMovieAssetFileNames(resolveMovieBaseName(item), "followVideo"),
    [item],
  );

  const posterCandidates = useMemo(() => {
    const fixedCandidates = buildImageSourceCandidates({
      remotePath: item?.posterUrl,
      filePath: assetBasePath,
      outputPath: item?.outputPath,
      fileName: "poster.jpg",
    });

    return [
      fixedCandidates.primary,
      buildLocalImageCandidate(assetBasePath, item?.outputPath, movieAssetFileNames.poster),
      fixedCandidates.fallback,
    ];
  }, [assetBasePath, item?.outputPath, item?.posterUrl, movieAssetFileNames.poster]);

  const thumbCandidates = useMemo(() => {
    const fixedCandidates = buildImageSourceCandidates({
      remotePath: item?.thumbUrl ?? item?.fanartUrl,
      filePath: assetBasePath,
      outputPath: item?.outputPath,
      fileName: "thumb.jpg",
    });

    return [
      fixedCandidates.primary,
      buildLocalImageCandidate(assetBasePath, item?.outputPath, movieAssetFileNames.thumb),
      fixedCandidates.fallback,
    ];
  }, [assetBasePath, item?.fanartUrl, item?.outputPath, item?.thumbUrl, movieAssetFileNames.thumb]);
  const posterCandidateKey = posterCandidates.join("\u0000");
  const thumbCandidateKey = thumbCandidates.join("\u0000");
  const posterCandidateKeyRef = useRef(posterCandidateKey);
  const thumbCandidateKeyRef = useRef(thumbCandidateKey);
  const posterRenderableCandidates = useResolvedImageCandidates(posterCandidates);
  const thumbRenderableCandidates = useResolvedImageCandidates(thumbCandidates);
  const nfoDirty = nfoOpen && serializeEditableNfoData(nfoData) !== nfoInitialSnapshot;

  useEffect(() => {
    if (posterCandidateKeyRef.current === posterCandidateKey) {
      return;
    }

    posterCandidateKeyRef.current = posterCandidateKey;
    setPosterCandidateIndex(0);
  }, [posterCandidateKey]);

  useEffect(() => {
    if (thumbCandidateKeyRef.current === thumbCandidateKey) {
      return;
    }

    thumbCandidateKeyRef.current = thumbCandidateKey;
    setThumbCandidateIndex(0);
  }, [thumbCandidateKey]);

  useEffect(() => {
    setPosterSrc(posterRenderableCandidates[posterCandidateIndex] ?? "");
  }, [posterCandidateIndex, posterRenderableCandidates]);

  useEffect(() => {
    setThumbSrc(thumbRenderableCandidates[thumbCandidateIndex] ?? "");
  }, [thumbCandidateIndex, thumbRenderableCandidates]);

  const openNfoEditor = useCallback(async (path: string) => {
    try {
      setNfoLoading(true);
      const response = await readNfo(path);
      const editableData = normalizeEditableNfoData(response.data.crawlerData);
      setNfoPath(response.data.path);
      setNfoData(editableData);
      setNfoInitialSnapshot(serializeEditableNfoData(editableData));
      setNfoValidationErrors({});
      setNfoOpen(true);
    } catch (error) {
      toast.error(`加载 NFO 失败: ${toErrorMessage(error)}`);
    } finally {
      setNfoLoading(false);
    }
  }, []);

  const handleSaveNfo = useCallback(async () => {
    const validation = validateEditableNfoData(nfoData);
    setNfoValidationErrors(validation.errors);
    if (!validation.valid || !validation.data) {
      const firstMessage = Object.values(validation.errors)[0] ?? "请检查表单内容";
      toast.error(firstMessage);
      return;
    }

    try {
      setNfoSaving(true);
      await updateNfo(nfoPath, validation.data, item?.path);
      toast.success("NFO 已保存");
      setNfoInitialSnapshot(serializeEditableNfoData(normalizeEditableNfoData(validation.data)));
      setNfoOpen(false);
    } catch (error) {
      toast.error(`保存 NFO 失败: ${toErrorMessage(error)}`);
    } finally {
      setNfoSaving(false);
    }
  }, [item?.path, nfoData, nfoPath]);

  const handleNfoOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setNfoOpen(true);
        return;
      }

      if (nfoSaving) {
        return;
      }

      if (nfoDirty && !window.confirm("放弃未保存的 NFO 修改？")) {
        return;
      }

      setNfoOpen(false);
      setNfoValidationErrors({});
    },
    [nfoDirty, nfoSaving],
  );

  const handlePlay = useCallback(() => {
    if (!item?.path) {
      toast.info("请先选择一个项目");
      return;
    }

    void playMediaPath(item.path);
  }, [item?.path]);

  const handleOpenFolder = useCallback(() => {
    if (!item?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(getDirFromPath(item.path));
    } else {
      toast.info("打开文件夹功能仅在桌面模式下可用");
    }
  }, [item?.path]);

  const handleOpenNfo = useCallback(async () => {
    const path = item?.nfoPath ?? item?.path;
    if (!path) {
      toast.info("请先选择一个项目");
      return;
    }
    await openNfoEditor(path);
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  const handlePosterError = useCallback(() => {
    setPosterCandidateIndex((currentIndex) => Math.min(currentIndex + 1, posterRenderableCandidates.length));
  }, [posterRenderableCandidates.length]);

  const handleThumbError = useCallback(() => {
    setThumbCandidateIndex((currentIndex) => Math.min(currentIndex + 1, thumbRenderableCandidates.length));
  }, [thumbRenderableCandidates.length]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ path?: string }>;
      const path = custom.detail?.path || item?.nfoPath || item?.path;
      if (!path) return;
      void openNfoEditor(path);
    };

    window.addEventListener("app:open-nfo", listener);
    return () => {
      window.removeEventListener("app:open-nfo", listener);
    };
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  return {
    posterSrc,
    thumbSrc,
    nfoOpen,
    nfoData,
    nfoDirty,
    nfoValidationErrors,
    nfoLoading,
    nfoSaving,
    setNfoOpen: handleNfoOpenChange,
    setNfoData,
    handlePlay,
    handleOpenFolder,
    handleOpenNfo,
    handlePosterError,
    handleThumbError,
    handleSaveNfo,
  };
}
