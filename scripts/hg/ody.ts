import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { gtmReportTime } from "./lib/gtm";
import { hoursToHms } from "./lib/time";

let agendaStatus:
  | { title: string; end_time: string; duration: number; description: string }
  | undefined = undefined;
let gtmStatus = { dww: "0", dwp: "0" };
let status = "";

(async function main() {
  runWithInterval(gtm, 60000);
  runWithInterval(agenda, 60000);
  runWithInterval(renderStatus, 1000);
  // TODO: count only gtm events aligned with trello card - ALIGNMENT
  // git log --grep https://trello.com/c/OeVPp5NG --pretty=%H | gtm report -format summary
})();

function agenda() {
  const res = JSON.parse(
    execSync(
      `gcalcli --calendar LSS agenda "$(date '+%Y-%m-%d %H:%M')" "$(date -d '+10 minutes' '+%Y-%m-%d %H:%M')" --tsv --details "description" | npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/cq.ts | jq`,
      { encoding: "utf8" },
    ),
  );
  if (res.length) {
    agendaStatus = res[0];
  } else {
    agendaStatus = undefined;
  }
}

function gtm() {
  const dww = hoursToHms(gtmReportTime("dww")).slice(0, -3);
  const dwp = hoursToHms(gtmReportTime("dwp")).slice(0, -3);
  gtmStatus = { dww, dwp };
}

function renderStatus() {
  let agenda = "";
  const { dww, dwp } = gtmStatus;
  let gtm = `W:${dww} P:${dwp}`;
  if (agendaStatus) {
    agenda = `${agendaStatus.title} ⌛ ${remainingHms(agendaStatus).slice(0, -3)} / ${hoursToHms(agendaStatus.duration).slice(0, -3)}`;
    const labelMatch = agendaStatus.description.match(/label:([^>]+)/);
    if (labelMatch) {
      gtm = gtmStatus[labelMatch[1]];
    }
  }
  status = [agenda, gtm].filter((e) => e.length).join(" | ");
  return writeFileSync(`${process.env.HOME}/.ody`, status);
}

function remainingHms({ end_time }) {
  const endTime = end_time.split(":");
  const now = new Date();
  const endDateTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    endTime[0],
    endTime[1],
  );

  return hoursToHms(
    (Date.parse(endDateTime.toISOString()) - Date.parse(now.toISOString())) /
      3600000,
  );
}
function runWithInterval(fn: () => void, interval: number) {
  fn();
  setInterval(fn, interval);
}

process.on("SIGINT", () => {
  status = "#[fg=red]STOPPED";
  writeFileSync(`${process.env.HOME}/.ody`, status);
  process.exit();
});

process.on("SIGTERM", () => {
  status = "#[fg=red]STOPPED";
  writeFileSync(`${process.env.HOME}/.ody`, status);
  process.exit();
});

process.on("unhandledRejection", (error) => {
  status = `ERROR: ${error}`;
  writeFileSync(`${process.env.HOME}/.ody`, status);
  process.exit();
});
