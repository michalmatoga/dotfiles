import { ghJson } from "./gh";

export type AssignedIssue = {
  title: string;
  url: string;
  body: string | null;
  repo: string | null;
};

const extractRepoSlug = (host: string, url: string): string | null => {
  const escapedHost = host.replace(/\./g, "\\.");
  const match = url.match(
    new RegExp(`https://${escapedHost}/([^/]+/[^/]+)/issues/\\d+`),
  );
  return match?.[1] ?? null;
};

export const fetchAssignedIssues = async (options: {
  host: string;
  user: string;
}): Promise<AssignedIssue[]> => {
  const response = await ghJson<Array<{ title: string; url: string; body: string | null }>>(
    [
      "search",
      "issues",
      "--assignee",
      options.user,
      "--state",
      "open",
      "--json",
      "title,url,body",
      "--limit",
      "200",
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
