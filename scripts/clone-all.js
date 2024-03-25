const ORGANIZATION = process.argv[2];
const TOKEN = process.env.GITHUB_TOKEN;

(async () => {
  const response = await fetch(
    `https://api.github.com/orgs/${ORGANIZATION}/repos?per_page=100`,
    {
      headers: {
        Authorization: `token ${TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    console.error(`Failed to fetch repos: ${response.statusText}`);
    return;
  }

  const repos = await response.json();

  for (const repo of repos) {
    console.log(repo.ssh_url);
  }
})();
