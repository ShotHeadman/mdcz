// Match a refusal to perform the requested task, not words that can occur in ordinary translated prose.
const CHINESE_REFUSAL =
  /^(?:(?:我)?(?:非常|十分|很)?(?:抱歉|对不起|對不起|遗憾|遺憾)[\s，,。.!！:：]*(?:但(?:是)?[\s，,]*)?)?(?:我(?:们|們)?[\s，,]*)?(?:目前|暂时|暫時)?(?:无法|無法|不能|不可以|不能够|不能夠)\s*(?:为你|為你|为您|為您)?\s*(?:翻[译譯](?:这|這|该|該|此|所提供|上述)|提供(?:这|這|该|該|此|所[请請]求|所提供|上述)?(?:段|个|個|些|类|類)?(?:内容|內容|文本|文字|[请請]求)?的?(?:翻[译譯]|[译譯]文)|(?:帮助|幫助|协助|協助|处理|處理|完成|满足|滿足)(?:你|您)?(?:[进進]行|[处處]理|完成|翻[译譯])?(?:这|這|该|該|此|所提供|上述)(?:个|個|项|項|类|類|段|些)?(?:[请請]求|内容|內容|翻[译譯]|文本|任务|任務))/u;
const APOLOGETIC_TRANSLATION_REFUSAL =
  /^(?:我)?(?:非常|十分|很)?(?:抱歉|对不起|對不起)[\s，,。.!！:：]*(?:但(?:是)?[\s，,]*)?我(?:们|們)?(?:目前|暂时|暫時)?(?:无法|無法|不能|不可以)(?:[为為](?:你|您))?翻[译譯][^。！？!?\n]{1,80}(?:内容|內容|文本)[。.!！]?$/u;
const CONDITIONAL_TRANSLATION_OFFER =
  /^(?:我(?:们|們)?)?(?:可以|能够|能夠)(?:[为為](?:你|您))?(?:[帮幫]助(?:你|您)?|[协協]助(?:你|您)?)?翻[译譯](?:[删刪]去|[删刪]除|去掉|移除|省略)[^。！？!?\n]{1,100}[后後](?:的)?版本[。.!！]?$/u;
const POLICY_CLASSIFICATION_WARNING =
  /^(?:[该該此](?:文本|文字|[请請]求|内容|內容)|[这這](?:段(?:文本|文字)|[个個][请請]求))(?:中)?(?:包含|含有|涉及)(?:[^。！？!?\n]{0,100}(?:敏感|受限制|受限|不允[许許]|[违違][规規]|禁止)[^。！？!?\n]{0,60}|[^。！？!?\n]{0,100}未成年(?:人)?的?(?:露骨|explicit\s*)?(?:性|色情)(?:相关|相關|描写|描寫|行为|行為|描述|描绘|描繪){0,2}的?)(?:内容|內容)[。.!！]?$/iu;
const ENGLISH_REFUSAL =
  /^(?:(?:i(?:'m| am)\s+)?sorry[\s,.!:]*(?:but\s+)?)?i(?:\s+(?:can(?:not|'t)|am unable to|must decline to)|'m unable to)\s+(?:(?:help|assist)(?:\s+you)?\s+(?:with\s+)?(?:this|that|the requested)\b|(?:provide|produce)\s+(?:a\s+|the\s+)?translation\b|translate\s+(?:this|that|the (?:provided|requested))\b)/iu;

export const isTranslationRefusal = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const text = value.normalize("NFKC").trim().replace(/[’‘]/gu, "'");
  return (
    CHINESE_REFUSAL.test(text) ||
    APOLOGETIC_TRANSLATION_REFUSAL.test(text) ||
    ENGLISH_REFUSAL.test(text) ||
    CONDITIONAL_TRANSLATION_OFFER.test(text) ||
    POLICY_CLASSIFICATION_WARNING.test(text)
  );
};

export const isUsableTranslation = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0 && !isTranslationRefusal(value);
