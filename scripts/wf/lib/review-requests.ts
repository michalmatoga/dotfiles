import { ghJson } from "./gh";

export type ReviewRequest = {
  title: string;
  url: string;
  body: string | null;
  repo: string | null;
};

type ReviewRequestResponse = {
  title: string;
  url: string;
  body: string | null;
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
  const response = await ghJson<ReviewRequestResponse[]>(
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

export const fetchReviewRequestByUrl = async (options: {
  host: string;
  url: string;
}): Promise<ReviewRequest> => {
  const response = await ghJson<ReviewRequestResponse>(
    ["pr", "view", options.url, "--json", "title,url,body"],
    { host: options.host },
  );

  return {
    title: response.title,
    url: response.url,
    body: response.body ?? null,
    repo: extractRepoSlug(options.host, response.url),
  };
};
