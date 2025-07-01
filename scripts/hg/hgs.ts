import { execSync } from "node:child_process";
import { gtmReportTime } from "./lib/gtm";
import { writeFileSync } from "node:fs";
import { hoursToHms } from "./lib/time";

const journalDir = "/home/nixos/ghq/gitlab.com/michalmatoga/journal";
const dataFile = "/mnt/g/My\\ Drive/hourglass.csv";
const date = process.argv[2] ?? new Date().toISOString().split("T")[0];

(async function main() {
  const dataSubtracted = collectDataSubtracted().split("\n");
  const journal = collectJournal().split("\n");
  const gtm = collectGtm().split("\n");
  const combinedData = [...dataSubtracted, ...journal, ...gtm]
    .filter((line) => line.trim() !== "")
    .sort();
  writeFileSync(
    "/mnt/g/My\ Drive/hourglass.csv",
    combinedData.join("\n") + "\n",
    {
      encoding: "utf8",
    },
  );
})();

function collectJournal() {
  return execSync(
    `rg -o '${date}\\s\\d{2}:\\d{2},\\[\\[d-[^\\n]+' ${journalDir} --no-filename | awk -F, 'NF >= 3 && $1 != "" && $2 != "" && $3 != ""' | sort | uniq`,
    { encoding: "utf8" },
  );
}

function collectGtm() {
  const time = process.argv[2]
    ? "23:59"
    : new Date().toTimeString().slice(0, 5);
  return ["dwp", "dww"]
    .map(
      (area) =>
        `${date} ${time},[[d-${area}]],${hoursToHms(gtmReportTime(area, date))}`,
    )
    .join("\n");
}

function collectDataSubtracted() {
  return execSync(`cat ${dataFile} | rg -v '^${date}'`, { encoding: "utf8" });
}
