const DMM_IMAGE_HOST = "pics.dmm.co.jp";
const DMM_AWS_IMAGE_HOST = "awsimgsrc.dmm.co.jp";
const DMM_PRIMARY_IMAGE_NAME_PATTERN = /([a-z0-9]+)(p[sl]\.jpg)$/iu;
const DMM_IMAGE_HOSTS = new Set([DMM_IMAGE_HOST, DMM_AWS_IMAGE_HOST]);

const appendUnique = (values: string[], value: string | null | undefined): void => {
  if (!value || values.includes(value)) {
    return;
  }

  values.push(value);
};

export const normalizeDmmNumberVariants = (raw: string): { number00: string; numberNo00: string } => {
  let normalized = raw.trim().toLowerCase();
  const match = normalized.match(/\d*[a-z]+-?(\d+)/u);
  if (match) {
    const digits = match[1];
    if (digits.length >= 5 && digits.startsWith("00")) {
      normalized = normalized.replace(digits, digits.slice(2));
    } else if (digits.length === 4) {
      normalized = normalized.replace("-", "0");
    }
  }

  return {
    number00: normalized.replace("-", "00"),
    numberNo00: normalized.replace("-", ""),
  };
};

export const isDmmImageUrl = (value?: string | null): boolean => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return DMM_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const toAwsMirrorUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== DMM_IMAGE_HOST) {
      return null;
    }

    url.protocol = "https:";
    url.hostname = DMM_AWS_IMAGE_HOST;
    url.pathname = `/pics_dig${url.pathname.replace("/adult/", "/")}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const buildNumberDerivedAwsUrl = (value: string, rawNumber: string): string[] => {
  try {
    const fileName = new URL(value).pathname.split("/").pop()?.toLowerCase() ?? "";
    const match = fileName.match(DMM_PRIMARY_IMAGE_NAME_PATTERN);
    if (!match) {
      return [];
    }

    const suffix = match[2];
    const { number00, numberNo00 } = normalizeDmmNumberVariants(rawNumber);
    return [
      `https://${DMM_AWS_IMAGE_HOST}/pics_dig/digital/video/${number00}/${number00}${suffix}`,
      `https://${DMM_AWS_IMAGE_HOST}/pics_dig/digital/video/${numberNo00}/${numberNo00}${suffix}`,
    ];
  } catch {
    return [];
  }
};

export const buildDmmAwsImageCandidates = (value: string, rawNumber?: string): string[] => {
  const candidates: string[] = [];
  const directCandidate = toAwsMirrorUrl(value);
  appendUnique(candidates, directCandidate);

  if (rawNumber && !directCandidate?.includes("/digital/video/")) {
    for (const candidate of buildNumberDerivedAwsUrl(value, rawNumber)) {
      appendUnique(candidates, candidate);
    }
  }

  return candidates;
};
