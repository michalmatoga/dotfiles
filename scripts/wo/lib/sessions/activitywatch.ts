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
