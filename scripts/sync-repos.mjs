import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fetchConfig = JSON.parse(
  readFileSync(path.join(__dirname, "../repositories.json"), "utf8"),
);

const secrets = JSON.parse(
  readFileSync(path.join(__dirname, "../secrets.json"), "utf8"),
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
  "schibsted.ghe.com": {
    urlTemplate:
      "https://api.schibsted.ghe.com/orgs/ORG_ID/repos?per_page=100",
    headers: { Authorization: `token ${secrets.ghec_pat_sch}` },
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


function setupDirenv() {
  const rootDir = "~/ghq/github.schibsted.io";
  execSync(
    `echo 'prefix = "/home/nixos/.cache/npm/global"' > ${rootDir}/.npmrc`,
  );
  execSync(
    `cat ${__dirname}/../secrets.json | jq -r '.npmrc_sch' | base64 -d >> ${rootDir}/.npmrc`,
  );
  const vars = [
    `NPM_CONFIG_USERCONFIG=${rootDir}/.npmrc`,
    `GH_USER="michal-matoga"`,
    "VAULT_ADDR=https://vault.int.vgnett.no",
    "VAULT_SKIP_VERIFY=1",
  ];
  execSync(
    `echo -e '${vars
      .map((v) => `export ${v}`)
      .join("\n")}' > ${rootDir}/.envrc && direnv allow ${rootDir}`,
  );
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
    console.log(`Removing repos:\n\n${removeList}`);
    const rmParams = removeList
      .trim()
      .split("\n")
      .map((repo) => `~/ghq/${repo}`)
      .join(" ");
    execSync(`rm -rf ${rmParams}`);
    execSync('find ~/ghq -type d -empty -not -path "*.git*" -delete');
  }
  setupDirenv();
})();
