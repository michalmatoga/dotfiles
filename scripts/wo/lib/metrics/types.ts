export type MetricsEventType = "entered" | "exited";

export type MetricsRecord = {
  timestamp: string;
  cardId: string;
  url: string | null;
  eventType: MetricsEventType;
  list: string;
  labels: string[];
  secondsInList: number | null;
  completedDate: string | null;
};

export type CardListState = {
  cardId: string;
  list: string;
  enteredAt: string;
  labels: string[];
  url: string | null;
};

export const listNames = {
  triage: "Triage",
  ready: "Ready",
  doing: "Doing",
  waiting: "Waiting",
  done: "Done",
} as const;

export const labelNames = {
  schibsted: "schibsted",
  review: "review",
  careerDelivery: "career-delivery",
  business: "business",
  career: "career",
  health: "health",
  growth: "growth",
  relationships: "relationships",
  household: "household",
  elikonas: "elikonas",
  journal: "journal",
  dotfiles: "dotfiles",
} as const;

export type LabelName = (typeof labelNames)[keyof typeof labelNames];

export const normalizeMetricLabels = (labels: string[]): string[] => {
  const unique = new Set<string>();
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
};

export const getPrimaryLabel = (labels: string[]): string | null => {
  const normalized = normalizeMetricLabels(labels);
  const priority = [
    labelNames.schibsted,
    labelNames.review,
    labelNames.careerDelivery,
    labelNames.business,
    labelNames.career,
    labelNames.health,
    labelNames.growth,
    labelNames.relationships,
    labelNames.household,
    labelNames.elikonas,
    labelNames.journal,
    labelNames.dotfiles,
  ];
  for (const name of priority) {
    if (normalized.includes(name)) {
      return name;
    }
  }
  return normalized[0] ?? null;
};

export const formatMetricsRecord = (record: MetricsRecord): string => {
  const escape = (s: string | null): string => {
    if (s === null) return "";
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  return [
    escape(record.timestamp),
    escape(record.cardId),
    escape(record.url),
    escape(record.eventType),
    escape(record.list),
    escape(record.labels.join("|")),
    record.secondsInList?.toString() ?? "",
    escape(record.completedDate),
  ].join(",");
};

export const parseMetricsRecord = (line: string): MetricsRecord => {
  const unescape = (s: string): string | null => {
    const normalized = s.endsWith("\r") ? s.slice(0, -1) : s;
    if (normalized === "") return null;
    if (normalized.startsWith('"') && normalized.endsWith('"')) {
      return normalized.slice(1, -1).replace(/""/g, '"');
    }
    return normalized;
  };

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);

  return {
    timestamp: unescape(parts[0] ?? "") ?? "",
    cardId: unescape(parts[1] ?? "") ?? "",
    url: unescape(parts[2] ?? ""),
    eventType: (unescape(parts[3] ?? "") as MetricsEventType) ?? "entered",
    list: unescape(parts[4] ?? "") ?? "",
    labels: normalizeMetricLabels((unescape(parts[5] ?? "") ?? "").split("|")),
    secondsInList: parts[6] ? parseInt(parts[6], 10) : null,
    completedDate: unescape(parts[7] ?? ""),
  };
};
