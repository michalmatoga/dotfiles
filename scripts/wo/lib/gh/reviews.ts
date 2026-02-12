import { ghJson } from "./gh";

export type ReviewRequest = {
  title: string;
  url: string;
  body: string | null;
  repo: string | null;
  baseRefName?: string | null;
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
    baseRefName: null,
  }));
};

export const hasApprovedReview = async (options: {
  host: string;
  url: string;
  user: string;
}): Promise<boolean> => {
  const response = await ghJson<{
    reviews: Array<{ author: { login: string }; state: string }>;
  }>(["pr", "view", options.url, "--json", "reviews"], { host: options.host });

  return response.reviews.some(
    (review) => review.author.login === options.user && review.state === "APPROVED",
  );
};
