export type MetricsEventType = "entered" | "exited";

export type MetricsRecord = {
  timestamp: string;
  cardId: string;
  url: string | null;
  eventType: MetricsEventType;
  list: string;
  label: string | null;
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
  inbox: "Inbox",
  triage: "Triage",
  ready: "Ready",
  doing: "Doing",
  waiting: "Waiting",
  done: "Done",
} as const;

export const labelNames = {
  schibsted: "schibsted",
  review: "review",
  household: "household",
  elikonas: "elikonas",
  journal: "journal",
  dotfiles: "dotfiles",
} as const;

export type LabelName = (typeof labelNames)[keyof typeof labelNames];

export const getPrimaryLabel = (labels: string[]): string | null => {
  const priority = [
    labelNames.schibsted,
    labelNames.review,
    labelNames.household,
    labelNames.elikonas,
    labelNames.journal,
    labelNames.dotfiles,
  ];
  for (const name of priority) {
    if (labels.includes(name)) {
      return name;
    }
  }
  return null;
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
    escape(record.label),
    record.secondsInList?.toString() ?? "",
    escape(record.completedDate),
  ].join(",");
};

export const parseMetricsRecord = (line: string): MetricsRecord => {
  const unescape = (s: string): string | null => {
    if (s === "") return null;
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/""/g, '"');
    }
    return s;
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
    label: unescape(parts[5] ?? ""),
    secondsInList: parts[6] ? parseInt(parts[6], 10) : null,
    completedDate: unescape(parts[7] ?? ""),
  };
};
