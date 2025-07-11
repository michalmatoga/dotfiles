import { execSync } from "node:child_process";
import { toHours } from "./time";

export function gtmReportTime(tag: string, date: string = "") {
  let timeFilter = "-today";
  if (date) {
    const fromDate = new Date(date);
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 1);
    const toDateString = toDate.toISOString().split("T")[0];
    timeFilter = `-from-date ${date} -to-date ${toDateString}`;
  }
  const gtmReportTime = execSync(
    `gtm report ${timeFilter} -format summary -tags ${tag} | grep -v '^\s*$' | sed 's/^[ \t]*//' | tail -n 1`,
    {
      stdio: ["inherit"],
      encoding: "utf8",
    },
  );
  return toHours(gtmReportTime);
}

export function gtmReportTimeRange(
  tags: string,
  start: Date,
  end: Date,
): number {
  const res = execSync(`gtm report -today -tags ${tags} | sed 1d`, {
    encoding: "utf8",
    stdio: ["inherit"],
  })
    .split("/hr]\n")
    .map((entry) => {
      if (!entry) {
        return null;
      }
      const dateStr = entry.split("\n")[2].split(" ").slice(0, -2).join(" ");
      if (!dateStr) {
        return null;
      }
      const date = new Date(dateStr);
      if (date < start || date >= end) {
        return null;
      }
      const duration = toHours(
        entry
          .split("\n")
          .at(-1)
          ?.trim()
          .split("  ")
          .slice(0, 2)
          .join(" ")
          .trim() || "",
      );
      return { date, duration };
    })
    .filter((e) => e !== null)
    .reduce((prev, curr) => prev + curr.duration, 0);
  return res;
}

export function gtmStatusTime() {
  const gtmStatusTime = execSync(`gtm status -total-only`, {
    encoding: "utf8",
  });

  return toHours(gtmStatusTime);
}
