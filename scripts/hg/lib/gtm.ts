import { execSync } from "node:child_process";
import { toHours } from "./time";

export function gtmReportTime(tag: string) {
  const gtmReportTime = execSync(
    `gtm report -today -format summary -tags ${tag} | grep -v '^\s*$' | sed 's/^[ \t]*//' | tail -n 1`,
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

  // const delta = execSync(
  //   `gtm status -tags ${tag} | rg '${tag}[,\\]]' | wc -l`,
  //   {
  //     encoding: "utf8",
  //   },
  // ).trim();
  return toHours(gtmStatusTime);
}
