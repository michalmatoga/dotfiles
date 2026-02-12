import { ghJson } from "./gh";

type IssueStateResponse = {
  state: string;
};

const parseIssueUrl = (host: string, url: string) => {
  const escapedHost = host.replace(/\./g, "\\.");
  const match = url.match(
    new RegExp(`https://${escapedHost}/([^/]+)/([^/]+)/(issues|pull)/(\\d+)`),
  );
  if (!match) {
    return null;
  }
  const [, owner, repo, , number] = match;
  return { owner, repo, number };
};

export const isIssueOpen = async (options: { host: string; url: string }): Promise<boolean> => {
  const parsed = parseIssueUrl(options.host, options.url);
  if (!parsed) {
    return true;
  }
  const response = await ghJson<IssueStateResponse>(
    ["api", `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`],
    { host: options.host },
  );
  return response.state === "open";
};
