import { ghJson } from "./gh";

export type ReviewRequest = {
  title: string;
  url: string;
  body: string | null;
  repo: string | null;
};

export const extractRepoSlug = (host: string, url: string): string | null => {
  const escapedHost = host.replace(/\./g, "\\.");
  const match = url.match(
    new RegExp(`https://${escapedHost}/([^/]+/[^/]+)/pull/\\d+`),
  );
  return match?.[1] ?? null;
};

export const fetchReviewRequests = async (options: {
  host: string;
  user: string;
}): Promise<ReviewRequest[]> => {
  const response = await ghJson<Array<{ title: string; url: string; body: string | null }>>(
    [
      "search",
      "prs",
      "draft:false",
      "--review-requested",
      options.user,
      "--state",
      "open",
      "--json",
      "title,url,body",
      "--limit",
      "100",
    ],
    { host: options.host },
  );

  return response.map((item) => ({
    title: item.title,
    url: item.url,
    body: item.body ?? null,
    repo: extractRepoSlug(options.host, item.url),
  }));
};
