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

export function gtmStatusTime() {
  const gtmStatusTime = execSync(`gtm status -total-only`, {
    encoding: "utf8",
  });

  return toHours(gtmStatusTime);
}
