import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dateFromTime, hmsToHours, hoursToHm, hoursToHms } from "./lib/time";

let agendaStatus:
  | {
      title: string;
      start_time: string;
      end_time: string;
      duration: number;
      description: string;
    }
  | undefined = undefined;
let gtmStatus = "";
let status = "";

(async function main() {
  runWithInterval(agenda, 60000);
  runWithInterval(gtm, 60000);
  runWithInterval(renderStatus, 1000);
})();

function agenda() {
  // TODO: run gtm-clean-all at the beginning
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
  gtmStatus = "";
  if (agendaStatus) {
    const labelMatch = agendaStatus.description.match(/label:([^>]+)/);
    if (labelMatch) {
      const label = labelMatch[1];
      const currentTimeBlockCommittedTime = JSON.parse(
        execSync(
          `npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/gtm-report-range.ts --start "${dateFromTime(agendaStatus.start_time)}" --end "${dateFromTime(agendaStatus.end_time)}" "trello-label: ${label}" | tail -n 1 | jq`,
          { encoding: "utf8" },
        ),
      );
      const cycleTime = JSON.parse(
        execSync(
          `npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/gtm-report-range.ts "trello-label: ${label}" | tail -n 1 | jq`,
          { encoding: "utf8" },
        ),
      );
      gtmStatus = `📅 ${decodeURI(label)} \u2699 ${currentTimeBlockCommittedTime.totalDuration} (${(hmsToHours(currentTimeBlockCommittedTime.totalDuration) / agendaStatus.duration) * 100}%) \u23F1  ${cycleTime.totalDuration}`;
    }
  }
}

function renderStatus() {
  let agenda = "#[fg=yellow]💤";
  if (agendaStatus) {
    agenda = `${agendaStatus.title} ⌛ ${remainingHms(agendaStatus).slice(0, -3)} / ${hoursToHm(agendaStatus.duration)}`;
  }
  status = [agenda, gtmStatus].filter((e) => e.length).join(" | ");
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
  console.error(error);
  status = `ERROR: ${error}`;
  writeFileSync(`${process.env.HOME}/.ody`, status);
  process.exit();
});
