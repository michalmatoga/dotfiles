import { runCommandCapture } from "../command";

export const ghJson = async <T,>(
  args: string[],
  options: { host?: string } = {},
): Promise<T> => {
  try {
    if (options.host) {
      process.env.GH_HOST = options.host;
    }
    const stdout = await runCommandCapture("gh", args);
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hostLabel = options.host ? ` (${options.host})` : "";
    throw new Error(
      `Failed to query GitHub via gh CLI${hostLabel}. ${message}. Ensure gh auth is set up${
        options.host ? ` for ${options.host}` : ""
      }.`,
    );
  }
};

export const ghGraphql = async <T,>(
  query: string,
  variables: Record<string, string | number | undefined>,
  options: { host?: string } = {},
): Promise<T> => {
  try {
    if (options.host) {
      process.env.GH_HOST = options.host;
    }
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined) {
        continue;
      }
      args.push("-F", `${key}=${value}`);
    }
    const stdout = await runCommandCapture("gh", args);
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hostLabel = options.host ? ` (${options.host})` : "";
    throw new Error(
      `Failed to query GitHub GraphQL via gh CLI${hostLabel}. ${message}. Ensure gh auth is set up${
        options.host ? ` for ${options.host}` : ""
      }.`,
    );
  }
};
