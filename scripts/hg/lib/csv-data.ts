import { execSync } from "node:child_process";

export function queryCsv(labelFilter: string = "", timeFilter: string = "") {
  return execSync(
    `cat /mnt/g/My\\ Drive/hourglass.csv | rg "${timeFilter}" | rg "${labelFilter}" || true`,
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .map((l: string) => l.split(","));
}
