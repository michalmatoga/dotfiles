import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { gtmReportTime, gtmReportTimeRange } from "./lib/gtm";
import { dateFromTime, hoursToHm, hoursToHms } from "./lib/time";

let agendaStatus:
  | {
      title: string;
      start_time: string;
      end_time: string;
      duration: number;
      description: string;
    }
  | undefined = undefined;
let gtmStatus: { dww: Record<string, any>; dwp: Record<string, any> } = {
  dww: {},
  dwp: {},
};
let status = "";

(async function main() {
  runWithInterval(agenda, 60000);
  runWithInterval(gtm, 60000);
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
  const dwwTotal = gtmReportTime("dww");
  const dwpTotal = gtmReportTime("dwp");
  let dwpCurrent = 0;
  let dwwCurrent = 0;

  if (agendaStatus) {
    dwpCurrent = gtmReportTimeRange(
      "dwp",
      dateFromTime(agendaStatus.start_time),
      dateFromTime(agendaStatus.end_time),
    );
    dwwCurrent = gtmReportTimeRange(
      "dww",
      dateFromTime(agendaStatus.start_time),
      dateFromTime(agendaStatus.end_time),
    );
  }
  gtmStatus = {
    dww: { total: dwwTotal, current: dwwCurrent },
    dwp: { total: dwpTotal, current: dwpCurrent },
  };
}

function renderStatus() {
  let agenda = "";
  const { dww, dwp } = gtmStatus;
  let gtm = `W:${hoursToHm(dww.total)} P:${hoursToHm(dwp.total)}`; // TODO: calculate total utilisation per bucket
  if (agendaStatus) {
    agenda = `${agendaStatus.title} ⌛ ${remainingHms(agendaStatus).slice(0, -3)} / ${hoursToHm(agendaStatus.duration)}`;
    const labelMatch = agendaStatus.description.match(/label:([^>]+)/);
    if (labelMatch) {
      const utilisation =
        (gtmStatus[labelMatch[1]].current / agendaStatus.duration) * 100;
      gtm = `⚙️  ${hoursToHm(gtmStatus[labelMatch[1]].current)} (${utilisation.toPrecision(2)}%)`;
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
  console.error(error);
  status = `ERROR: ${error}`;
  writeFileSync(`${process.env.HOME}/.ody`, status);
  process.exit();
});
