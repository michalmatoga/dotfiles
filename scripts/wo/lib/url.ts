const markdownLinkUrlPattern = /^\[[^\]]+\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)$/i;
const firstHttpUrlPattern = /https?:\/\/[^\s)\]"]+/i;

export const normalizeLinkedUrlValue = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const markdownMatch = trimmed.match(markdownLinkUrlPattern);
  if (markdownMatch?.[1]) {
    return markdownMatch[1];
  }

  const firstUrlMatch = trimmed.match(firstHttpUrlPattern);
  if (firstUrlMatch?.[0]) {
    return firstUrlMatch[0];
  }

  return trimmed;
};

export const normalizeLinkedUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = normalizeLinkedUrlValue(value);
  return normalized || null;
};
