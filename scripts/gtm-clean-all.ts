import { execSync } from "node:child_process";
import readline from "readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async function main() {
  const projectsToClean = execSync(`gtm status -all`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n\n")
    .map((p) => p.split("\n").at(-1))
    .join("\n");

  console.log(projectsToClean);
  const answer = await rl.question("Proceed? [Y/n]");
  rl.close();
  if (!["y", ""].includes(answer.toLowerCase())) {
    return;
  }
  const projectNames = [...projectsToClean.matchAll(/\s(\w+)\s\[/gm)].map(
    (m) => m[1],
  );

  const projectPaths = execSync(
    `find ~/ghq -maxdepth 3 -mindepth 3 -type d \\( ${projectNames.map((p) => "-name " + p).join(" -o ")} \\)`,
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of projectPaths) {
    execSync(`cd ${path} && pwd && gtm status`, { stdio: "inherit" });
  }
})();
