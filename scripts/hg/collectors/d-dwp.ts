import { execSync } from "node:child_process";

(function main() {})();

export function gtmReportTime(tag: string) {
  const gtmReportTime = execSync(
    `gtm report -today -format summary -tags ${tag} | grep -v '^\s*$' | sed 's/^[ \t]*//' | tail -n 1`,
    {
      stdio: ["inherit"],
      encoding: "utf8",
    },
  );
  return toHms(gtmReportTime);
}

export function gtmStatusTime(tag: string) {
  const gtmStatusTime = execSync(`gtm status -total-only`, {
    encoding: "utf8",
  });

  const delta = execSync(
    `gtm status -tags ${tag} | rg '${tag}[,\\]]' | wc -l`,
    {
      encoding: "utf8",
    },
  ).trim();
  return toHms(gtmStatusTime) + ` (Δ${delta}p)`;
}

function toHms(time: string) {
  let t = time.trim().slice(0, -1);
  if (!time.includes("h")) {
    t = "0h" + t;
  }
  const parts = t.replaceAll(" ", "").replaceAll(/[hms]/g, ":").split(":");
  const paddedParts = parts.map((part) =>
    part.length === 1 ? "0" + part : part,
  );
  return paddedParts.join(":");
}
