const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const fetchConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../repositories.json"), "utf8")
);

const secrets = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../secrets.json"), "utf8")
);

const providerApiMap = {
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
  "gitlab.com": {
    urlTemplate:
      "https://gitlab.com/api/v4/groups/ORG_ID/projects?per_page=100",
    headers: { "Private-Token": secrets.gl_pat_personal },
    fullNameKey: "path_with_namespace",
  },
};

async function fetchAllOrgRepos(provider, org) {
  const { urlTemplate, headers } = providerApiMap[provider];
  const response = await fetch(urlTemplate.replace("ORG_ID", org), { headers });

  if (!response.ok) {
    console.error(`Failed to fetch repos: ${response.statusText}`);
    process.exit(1);
  }

  return await response.json();
}

(async () => {
  const repos = [];
  for (const { provider, fetch } of fetchConfig) {
    const orgs = fetch.filter((entry) => !entry.includes("/"));
    const providerRepos = fetch
      .filter((entry) => entry.includes("/"))
      .map((entry) => [provider, entry].join("/"));
    for (const org of orgs) {
      const orgRepos = await fetchAllOrgRepos(provider, org);
      for (const repo of orgRepos) {
        const key = providerApiMap[provider].fullNameKey;
        providerRepos.push([provider, repo[key]].join("/"));
      }
    }
    repos.push(...providerRepos);
  }
  fs.writeFileSync("dist/repolist.txt", repos.join("\n"));

  const result = spawnSync(
    "bash",
    ["-c", "cat dist/repolist.txt | ghq get -p --shallow --parallel"],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    console.error("Command failed with status code:", result.status);
    process.exit(result.status);
  }

  const removeList = execSync(
    `bash -c "comm -23 <(ghq list | sort) <(sort dist/repolist.txt)"`
  ).toString();
  if (removeList) {
    console.log(`Removing repos:\n\n${removeList}`);
    const rmParams = removeList
      .trim()
      .split("\n")
      .map((repo) => `~/ghq/${repo}`)
      .join(" ");
    execSync(`rm -rf ${rmParams}`);
    execSync('find ~/ghq -type d -empty -not -path "*.git*" -delete');
  }
})();
