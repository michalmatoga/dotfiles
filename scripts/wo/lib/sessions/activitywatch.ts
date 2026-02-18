import { hostname } from "node:os";

const AW_PORT = process.env.AW_PORT ?? "5601";
const AW_HOST = process.env.AW_HOST ?? "localhost";
const AW_BASE_URL = `http://${AW_HOST}:${AW_PORT}/api/0`;

export type AWEvent = {
  id?: number;
  timestamp: string;
  duration: number;
  data: Record<string, unknown>;
};

export type AWBucket = {
  id: string;
  name?: string;
  type: string;
  client: string;
  hostname: string;
  created?: string;
  last_updated?: string;
};

type AWHeartbeatOptions = {
  bucketId: string;
  event: Omit<AWEvent, "id">;
  pulsetime: number;
};

const awFetch = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const url = `${AW_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AW request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json() as Promise<T>;
  }

  return undefined as T;
};

export const listBuckets = async (): Promise<Record<string, AWBucket>> => {
  return awFetch<Record<string, AWBucket>>("/buckets/");
};

export const getBucket = async (bucketId: string): Promise<AWBucket | null> => {
  try {
    return await awFetch<AWBucket>(`/buckets/${bucketId}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
};

export const createBucket = async (options: {
  bucketId: string;
  type: string;
  client: string;
  hostname?: string;
}): Promise<void> => {
  const bucket: AWBucket = {
    id: options.bucketId,
    type: options.type,
    client: options.client,
    hostname: options.hostname ?? hostname(),
  };

  await awFetch(`/buckets/${options.bucketId}`, {
    method: "POST",
    body: JSON.stringify(bucket),
  });
};

export const ensureBucket = async (options: {
  bucketId: string;
  type: string;
  client: string;
  hostname?: string;
}): Promise<void> => {
  const existing = await getBucket(options.bucketId);
  if (existing) {
    return;
  }
  await createBucket(options);
};

export const getEvents = async (
  bucketId: string,
  options: { start?: string; end?: string; limit?: number } = {},
): Promise<AWEvent[]> => {
  const params = new URLSearchParams();
  if (options.start) {
    params.set("start", options.start);
  }
  if (options.end) {
    params.set("end", options.end);
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = `/buckets/${bucketId}/events${query ? `?${query}` : ""}`;
  return awFetch<AWEvent[]>(path);
};

export const createEvent = async (
  bucketId: string,
  event: Omit<AWEvent, "id">,
): Promise<AWEvent> => {
  return awFetch<AWEvent>(`/buckets/${bucketId}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
};

export const heartbeat = async (options: AWHeartbeatOptions): Promise<AWEvent> => {
  const params = new URLSearchParams({ pulsetime: String(options.pulsetime) });
  return awFetch<AWEvent>(
    `/buckets/${options.bucketId}/heartbeat?${params.toString()}`,
    {
      method: "POST",
      body: JSON.stringify(options.event),
    },
  );
};

export type AWQueryResult = unknown[];

export const query = async (
  queryStrings: string[],
  timeperiods: Array<{ start: string; end: string }>,
): Promise<AWQueryResult[]> => {
  return awFetch<AWQueryResult[]>("/query/", {
    method: "POST",
    body: JSON.stringify({
      query: queryStrings,
      timeperiods: timeperiods.map((tp) => `${tp.start}/${tp.end}`),
    }),
  });
};

export const isServerAvailable = async (): Promise<boolean> => {
  try {
    await awFetch("/info");
    return true;
  } catch {
    return false;
  }
};

export const getTodayTimeRange = (): { start: string; end: string } => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return {
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
  };
};

export const aggregateEventDurations = (events: AWEvent[]): number => {
  return events.reduce((total, event) => total + event.duration, 0);
};

type AWInterval = {
  start: number;
  end: number;
  owner: string;
  seq: number;
};

type AWSegment = {
  start: number;
  end: number;
  owner: string;
};

const buildIntervals = (
  events: AWEvent[],
  getOwner: (event: AWEvent) => string,
): AWInterval[] => {
  return events
    .map((event, index) => {
      const start = new Date(event.timestamp).getTime();
      const durationMs = Math.max(0, Math.floor(event.duration * 1000));
      const end = start + durationMs;
      return {
        start,
        end,
        owner: getOwner(event),
        seq: index,
      };
    })
    .filter((interval) => interval.end > interval.start);
};

const pickMostRecentInterval = (intervals: AWInterval[]): AWInterval | null => {
  if (intervals.length === 0) {
    return null;
  }

  return intervals.reduce((latest, current) => {
    if (current.start > latest.start) {
      return current;
    }
    if (current.start === latest.start && current.seq > latest.seq) {
      return current;
    }
    return latest;
  });
};

const buildAssignedSegments = (
  events: AWEvent[],
  getOwner: (event: AWEvent) => string,
): AWSegment[] => {
  const intervals = buildIntervals(events, getOwner);
  if (intervals.length === 0) {
    return [];
  }

  const points = intervals.flatMap((interval) => [
    { time: interval.start, type: "start" as const, interval },
    { time: interval.end, type: "end" as const, interval },
  ]);

  points.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    if (a.type === b.type) {
      return 0;
    }
    return a.type === "end" ? -1 : 1;
  });

  const segments: AWSegment[] = [];
  const active: AWInterval[] = [];

  let index = 0;
  let currentTime = points[0].time;

  while (index < points.length) {
    const time = points[index].time;

    if (time > currentTime && active.length > 0) {
      const owner = pickMostRecentInterval(active);
      if (owner) {
        segments.push({ start: currentTime, end: time, owner: owner.owner });
      }
    }

    currentTime = time;

    while (index < points.length && points[index].time === time && points[index].type === "end") {
      const interval = points[index].interval;
      const pos = active.indexOf(interval);
      if (pos >= 0) {
        active.splice(pos, 1);
      }
      index++;
    }

    while (index < points.length && points[index].time === time && points[index].type === "start") {
      active.push(points[index].interval);
      index++;
    }
  }

  return segments;
};

const splitSegmentByHour = (segment: AWSegment): Array<{ hour: number; duration: number }> => {
  const result: Array<{ hour: number; duration: number }> = [];
  let cursor = segment.start;

  while (cursor < segment.end) {
    const cursorDate = new Date(cursor);
    const nextHour = new Date(cursorDate);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);

    const boundary = Math.min(segment.end, nextHour.getTime());
    const duration = Math.max(0, boundary - cursor) / 1000;
    if (duration > 0) {
      result.push({ hour: cursorDate.getHours(), duration });
    }
    cursor = boundary;
  }

  return result;
};

export const aggregateUniqueDuration = (events: AWEvent[]): number => {
  const segments = buildAssignedSegments(events, () => "__total__");
  return segments.reduce((total, segment) => total + (segment.end - segment.start) / 1000, 0);
};

export const aggregateUniqueDurationByDataKey = (
  events: AWEvent[],
  key: string,
): Map<string, number> => {
  const segments = buildAssignedSegments(events, (event) => String(event.data[key] ?? "unknown"));
  const totals = new Map<string, number>();

  for (const segment of segments) {
    const duration = (segment.end - segment.start) / 1000;
    const current = totals.get(segment.owner) ?? 0;
    totals.set(segment.owner, current + duration);
  }

  return totals;
};

export const aggregateUniqueDurationByHour = (events: AWEvent[]): Map<number, number> => {
  const segments = buildAssignedSegments(events, () => "__total__");
  const totals = new Map<number, number>();

  for (const segment of segments) {
    for (const slice of splitSegmentByHour(segment)) {
      const current = totals.get(slice.hour) ?? 0;
      totals.set(slice.hour, current + slice.duration);
    }
  }

  return totals;
};

export const aggregateUniqueDurationByDataKeyByHour = (
  events: AWEvent[],
  key: string,
): Map<string, number[]> => {
  const segments = buildAssignedSegments(events, (event) => String(event.data[key] ?? "unknown"));
  const totals = new Map<string, number[]>();

  for (const segment of segments) {
    const entry = totals.get(segment.owner) ?? Array(24).fill(0);
    for (const slice of splitSegmentByHour(segment)) {
      entry[slice.hour] += slice.duration;
    }
    totals.set(segment.owner, entry);
  }

  return totals;
};

export const collectDataKeyByHour = (
  events: AWEvent[],
  key: string,
): Map<number, Set<string>> => {
  const segments = buildAssignedSegments(events, (event) => String(event.data[key] ?? "unknown"));
  const totals = new Map<number, Set<string>>();

  for (const segment of segments) {
    for (const slice of splitSegmentByHour(segment)) {
      const current = totals.get(slice.hour) ?? new Set<string>();
      current.add(segment.owner);
      totals.set(slice.hour, current);
    }
  }

  return totals;
};

export const groupEventsByData = <K extends string>(
  events: AWEvent[],
  key: K,
): Map<string, AWEvent[]> => {
  const groups = new Map<string, AWEvent[]>();
  for (const event of events) {
    const value = String(event.data[key] ?? "unknown");
    const existing = groups.get(value) ?? [];
    existing.push(event);
    groups.set(value, existing);
  }
  return groups;
};
