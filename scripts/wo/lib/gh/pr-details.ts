import { ghJson } from "./gh";

export type PrDetails = {
  url: string;
  title: string;
  body: string | null;
  author: string | null;
  updatedAt: string | null;
  mergeable: string | null;
  merged: boolean;
  reviewRequests: string[];
  reviews: Array<{ author: string; state: string; submittedAt: string | null }>;
};

type PrDetailsResponse = {
  url: string;
  title: string;
  body: string | null;
  updatedAt: string | null;
  mergeable: string | null;
  mergedAt: string | null;
  state: string | null;
  author: { login: string } | null;
  reviewRequests: Array<{ login: string } | null>;
  reviews: Array<{ author: { login: string } | null; state: string; submittedAt: string | null }>;
};

export const fetchPrDetails = async (options: {
  host: string;
  url: string;
}): Promise<PrDetails> => {
  const response = await ghJson<PrDetailsResponse>(
    [
      "pr",
      "view",
      options.url,
      "--json",
      "url,title,body,updatedAt,mergeable,mergedAt,state,author,reviewRequests,reviews",
    ],
    { host: options.host },
  );

  return {
    url: response.url,
    title: response.title,
    body: response.body ?? null,
    updatedAt: response.updatedAt ?? null,
    mergeable: response.mergeable ?? null,
    merged: Boolean(response.mergedAt) || response.state === "MERGED",
    author: response.author?.login ?? null,
    reviewRequests: response.reviewRequests
      .map((request) => request?.login)
      .filter((login): login is string => Boolean(login)),
    reviews: response.reviews.map((review) => ({
      author: review.author?.login ?? "",
      state: review.state,
      submittedAt: review.submittedAt ?? null,
    })),
  };
};

export const resolveLatestReviewState = (details: PrDetails): string | null => {
  const sorted = [...details.reviews].sort((a, b) => {
    const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return bTime - aTime;
  });
  const latest = sorted.find((review) => review.state && review.state !== "COMMENTED");
  return latest?.state ?? null;
};
