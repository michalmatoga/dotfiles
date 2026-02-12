import { ghJson } from "./gh";

type AuthoredPrResponse = {
  url: string;
  body: string | null;
  updatedAt: string | null;
};

export const fetchAuthoredOpenPrs = async (options: {
  host: string;
  user: string;
  limit?: number;
}): Promise<AuthoredPrResponse[]> => {
  return ghJson<AuthoredPrResponse[]>(
    [
      "search",
      "prs",
      "--author",
      options.user,
      "--state",
      "open",
      "--json",
      "url,body,updatedAt",
      "--limit",
      String(options.limit ?? 50),
    ],
    { host: options.host },
  );
};
