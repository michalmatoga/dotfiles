import { readFile } from "node:fs/promises";

type LabelRepoMap = Record<string, string>;

const mappingPath = "scripts/wo/config/label-repos.json";

export type LabelRepoResolution =
  | { status: "none" }
  | { status: "multiple"; labels: string[] }
  | { status: "single"; label: string; repoPath: string };

export const loadLabelRepoMap = async (): Promise<Map<string, string>> => {
  const raw = await readFile(mappingPath, "utf8");
  const parsed = JSON.parse(raw) as LabelRepoMap;
  const entries = Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.length > 0);
  return new Map(entries);
};

export const resolveLabelRepo = (options: {
  labelNames: string[];
  mapping: Map<string, string>;
}): LabelRepoResolution => {
  const matches = options.labelNames
    .map((name) => ({ name, repoPath: options.mapping.get(name) ?? null }))
    .filter((entry) => Boolean(entry.repoPath)) as Array<{ name: string; repoPath: string }>;
  if (matches.length === 0) {
    return { status: "none" };
  }
  if (matches.length > 1) {
    return { status: "multiple", labels: matches.map((entry) => entry.name) };
  }
  return { status: "single", label: matches[0].name, repoPath: matches[0].repoPath };
};
