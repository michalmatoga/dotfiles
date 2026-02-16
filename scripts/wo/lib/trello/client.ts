import { requireEnv } from "../env";

export const trelloRequest = async <T,>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options: { method?: string } = {},
): Promise<T> => {
  // Safety: when running tests in recording mode, require explicit opt-in
  // before allowing the client to perform real network calls.
  const isRecording = process.env.NO_CACHE === "true";
  if (process.env.NODE_ENV === "test" && isRecording && process.env.ALLOW_TRELLO_RECORD !== "true") {
    throw new Error(
      "Trello API requests are blocked in test recording mode. Set ALLOW_TRELLO_RECORD=true and use a test board ID to allow recording.",
    );
  }

  const apiKey = requireEnv("TRELLO_API_KEY");
  const token = requireEnv("TRELLO_TOKEN");
  const url = new URL(`https://api.trello.com/1/${path}`);

  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { method: options.method ?? "GET" });
  if (!response.ok) {
    throw new Error(
      `Trello API request failed (${response.status} ${response.statusText}) for ${path}`,
    );
  }
  return (await response.json()) as T;
};
