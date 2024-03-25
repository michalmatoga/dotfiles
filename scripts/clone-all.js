const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const fetchConfig = [
  {
    provider: "github.com",
    fetch: ["elikonas", "michalmatoga/dotfiles"],
  },
  {
    provider: "github.schibsted.io",
    fetch: ["svp"],
  },
];

const secrets = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../secrets.json"), "utf8")
);

const providerApiMap = {
  "github.com": {
    baseUrl: "https://api.github.com",
    auth: secrets.gh_pat_personal,
  },
  "github.schibsted.io": {
    baseUrl: "https://github.schibsted.io/api/v3",
    auth: secrets.gh_pat_sch,
  },
};

async function fetchAllOrgRepos(provider, org) {
  const { baseUrl, auth } = providerApiMap[provider];
  const response = await fetch(`${baseUrl}/orgs/${org}/repos?per_page=100`, {
    headers: {
      Authorization: `token ${auth}`,
    },
  });

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
      for (const { full_name } of orgRepos) {
        providerRepos.push([provider, full_name].join("/"));
      }
    }
    repos.push(...providerRepos);
  }
  let i = 1;
  for (const repo of repos) {
    console.log(`Cloning ${repo}, ${i++}/${repos.length}`);
    execSync(`ghq get --shallow -p ${repo}`);
  }
})();
