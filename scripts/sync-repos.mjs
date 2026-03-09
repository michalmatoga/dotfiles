import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const buildProviderApiMap = (secrets) => ({
  "github.com": {
    urlTemplate: "https://api.github.com/orgs/ORG_ID/repos?per_page=100",
    headers: { Authorization: `token ${secrets.gh_pat_personal}` },
    fullNameKey: "full_name",
  },
  "github.schibsted.io": {
    urlTemplate:
      "https://github.schibsted.io/api/v3/orgs/ORG_ID/repos?per_page=100",
    headers: { Authorization: `token ${secrets.gh_pat_sch}` },
    fullNameKey: "full_name",
  },
  "schibsted.ghe.com": {
    urlTemplate: "https://api.schibsted.ghe.com/orgs/ORG_ID/repos?per_page=100",
    headers: { Authorization: `token ${secrets.ghec_pat_sch}` },
    fullNameKey: "full_name",
  },
  "gitlab.com": {
    urlTemplate:
      "https://gitlab.com/api/v4/groups/ORG_ID/projects?per_page=100",
    headers: { "Private-Token": secrets.gl_pat_personal },
    fullNameKey: "path_with_namespace",
  },
});

const loadSyncConfig = () => {
  const fetchConfig = JSON.parse(
    readFileSync(path.join(__dirname, "../repositories.json"), "utf8"),
  );
  const secrets = JSON.parse(
    readFileSync(path.join(__dirname, "../secrets.json"), "utf8"),
  );
  return {
    fetchConfig,
    providerApiMap: buildProviderApiMap(secrets),
  };
};

async function fetchAllOrgRepos(providerApiMap, provider, org) {
  const { urlTemplate, headers } = providerApiMap[provider];
  const response = await fetch(urlTemplate.replace("ORG_ID", org), { headers });

  if (!response.ok) {
    console.error(`Failed to fetch repos: ${response.statusText}`);
    process.exit(1);
  }

  return await response.json();
}

const normalizePath = (value) => value.replace(/\/+$/, "");

export const parseWorktreeList = (raw) => {
  const worktreePaths = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("worktree ")) {
      continue;
    }
    const worktreePath = line.slice("worktree ".length).trim();
    if (worktreePath) {
      worktreePaths.push(normalizePath(worktreePath));
    }
  }
  return worktreePaths;
};

export const listWorktreePaths = (repoPath, options = {}) => {
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const result = spawnSyncImpl("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return parseWorktreeList(result.stdout ?? "");
};

export const classifyRepoRemovals = (repos, options = {}) => {
  const homeDir = options.homeDir ?? process.env.HOME ?? "";
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const readdirSyncImpl = options.readdirSyncImpl ?? readdirSync;
  const listWorktreePathsImpl = options.listWorktreePathsImpl ?? listWorktreePaths;
  const ghqRoot = path.join(homeDir, "ghq");
  const removePaths = [];
  const skippedRepos = [];

  for (const repo of repos) {
    const parts = repo.split("/");
    if (parts.length < 3) {
      continue;
    }
    const repoName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);
    if (parentParts.length < 2 || !repoName) {
      continue;
    }
    if (repoName.includes("=")) {
      skippedRepos.push({ repo, reason: "worktree-path" });
      continue;
    }

    const repoPath = path.join(ghqRoot, ...parts);
    const ownerDir = path.join(ghqRoot, ...parentParts);
    let hasSiblingWorktrees = false;
    if (existsSyncImpl(ownerDir)) {
      const entries = readdirSyncImpl(ownerDir);
      hasSiblingWorktrees = entries.some((entry) => entry.startsWith(`${repoName}=`));
    }
    if (hasSiblingWorktrees) {
      skippedRepos.push({ repo, reason: "linked-worktrees" });
      continue;
    }

    const worktreePaths = listWorktreePathsImpl(repoPath);
    if (!worktreePaths) {
      skippedRepos.push({ repo, reason: "worktree-check-failed" });
      continue;
    }
    const normalizedRepoPath = normalizePath(repoPath);
    const linkedPaths = worktreePaths.filter((worktreePath) => worktreePath !== normalizedRepoPath);
    if (linkedPaths.length > 0) {
      skippedRepos.push({ repo, reason: "linked-worktrees" });
      continue;
    }

    removePaths.push(repoPath);
  }

  return { removePaths, skippedRepos };
};

export async function main() {
  const { fetchConfig, providerApiMap } = loadSyncConfig();
  const repos = [];
  for (const { provider, fetch } of fetchConfig) {
    const orgs = fetch.filter((entry) => !entry.includes("/"));
    const providerRepos = fetch
      .filter((entry) => entry.includes("/"))
      .map((entry) => [provider, entry].join("/"));
    for (const org of orgs) {
      const orgRepos = await fetchAllOrgRepos(providerApiMap, provider, org);
      for (const repo of orgRepos) {
        const key = providerApiMap[provider].fullNameKey;
        providerRepos.push([provider, repo[key]].join("/"));
      }
    }
    repos.push(...providerRepos);
  }
  writeFileSync("repolist.txt", repos.join("\n"));

  const result = spawnSync(
    "bash",
    ["-c", "cat repolist.txt | ghq get -p --shallow --parallel"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    console.error("Command failed with status code:", result.status);
    process.exit(result.status);
  }

  const removeList = execSync(
    `bash -c "comm -23 <(ghq list | sort) <(sort repolist.txt)"`,
  ).toString();
  if (removeList) {
    const rawRepos = removeList.trim().split("\n").filter(Boolean);
    const { removePaths, skippedRepos } = classifyRepoRemovals(rawRepos);
    if (removePaths.length > 0) {
      console.log(`Removing repos:\n\n${removePaths.join("\n")}`);
      spawnSync("rm", ["-rf", ...removePaths], { stdio: "inherit" });
    }
    if (skippedRepos.length > 0) {
      const skippedSummary = skippedRepos
        .map(({ repo, reason }) => `${repo} (${reason})`)
        .join("\n");
      console.log(`Skipped repos:\n\n${skippedSummary}`);
    }
    execSync('find ~/ghq -type d -empty -not -path "*.git*" -delete');
  }
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  await main();
}
