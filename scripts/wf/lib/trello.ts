import { requireEnv } from "./env";

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idLabels: string[];
  idList?: string;
};

export const trelloRequest = async <T,>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options: { method?: string } = {},
): Promise<T> => {
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
