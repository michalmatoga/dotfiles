import { execSync } from "node:child_process";
import { hoursToHm, toHours } from "./hg/lib/time";

(async function main() {
  const { start, end, positionals } = parseArgs();
  const dirs = execSync("find ~/ghq -maxdepth 3 -mindepth 3 -type d", {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  const greps = positionals.map((p) => `--grep="${p}"`).join(" ");
  const since = start ? `--since="${start}"` : "";
  const until = end ? `--until="${end}"` : "";
  let totalDuration = 0;
  console.log(`GTM range report`, since, until);
  for (const dir of dirs) {
    let sha1s = "";
    try {
      sha1s = execSync(
        `git -C ${dir} log ${since} ${until} --all-match ${greps} | rg -o '^commit (\\w+)' -r '$1'`,
        {
          encoding: "utf8",
        },
      ).trim();
    } catch (error) {}
    if (sha1s) {
      console.log(`### ${dir}`);
      const report = execSync(
        `cd ${dir} && echo "${sha1s}" | gtm report -format summary`,
        {
          stdio: ["inherit"],
          encoding: "utf8",
        },
      ).trim();
      const totalRepoDuration = execSync(`echo "${report}" | rg -o '^.+\\ds'`, {
        encoding: "utf8",
      })
        .split("\n")
        .slice(0, -2)
        .map((d) => toHours(d.trim()))
        .reduce((prev, curr) => prev + curr, 0);
      totalDuration += totalRepoDuration;
      console.log(report);
      console.log(
        JSON.stringify({ totalRepoDuration: hoursToHm(totalRepoDuration) }),
      );
    }
  }
  console.log(JSON.stringify({ totalDuration: hoursToHm(totalDuration) }));
})();

function parseArgs() {
  const args = process.argv.slice(2);
  let start: string | undefined;
  let end: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && i + 1 < args.length) {
      start = args[i + 1];
      i++; // Skip the next argument
    } else if (args[i] === "--end" && i + 1 < args.length) {
      end = args[i + 1];
      i++; // Skip the next argument
    } else {
      positionals.push(args[i]);
    }
  }
  return { start, end, positionals };
}
