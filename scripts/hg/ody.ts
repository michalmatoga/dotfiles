import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dateFromTime, hmsToHours, hoursToHm, hoursToHms } from "./lib/time";
import { getFirstCardInDoingList } from "./lib/trello";

interface AgendaStatus {
  title: string;
  start_time: string;
  end_time: string;
  duration: number;
  description: string;
  label: string;
  card: string;
}

let agendaStatus: AgendaStatus | undefined = undefined;
let gtmStatus = "";
let status = "";

(async function main() {
  runWithInterval(fetchAgendaStatus, 60000);
  runWithInterval(fetchGtmStatus, 60000);
  runWithInterval(renderStatus, 1000);
})();

async function fetchAgendaStatus() {
  const res = JSON.parse(
    execSync(
      `gcalcli --calendar LSS agenda "$(date '+%Y-%m-%d %H:%M')" "$(date -d '+10 minutes' '+%Y-%m-%d %H:%M')" --tsv --details "description" | npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/cq.ts | jq`,
      { encoding: "utf8" },
    ),
  ) as AgendaStatus[];
  if (res.length) {
    if (!agendaStatus) {
      agendaStatus = { ...res[0], label: "", card: "" };
    }
    const labelMatch = agendaStatus?.description.match(/label:([^>]+)/);
    if (labelMatch) {
      agendaStatus.label = labelMatch[1];
      const trelloRes = await getFirstCardInDoingList();
      if (
        trelloRes &&
        trelloRes.labels.find(({ name }) => name === agendaStatus?.label)
      ) {
        agendaStatus.card = trelloRes.name;
      }
    }
  } else {
    agendaStatus = undefined;
  }
}

function renderAgendaStatus() {
  if (!agendaStatus) {
    return "#[fg=yellow]💤🌴";
  }
  if (agendaStatus.card) {
    return `📋 ${agendaStatus.card} | ⌛ ${remainingHms(agendaStatus).slice(0, -3)} / ${hoursToHm(agendaStatus.duration)}`;
  }
  return `#[fg=red]⛔ No card in progress matching ${agendaStatus.title} / ${agendaStatus.label}`;
}

function fetchGtmStatus() {
  gtmStatus = "";
  if (agendaStatus && agendaStatus.label) {
    const currentTimeBlockCommittedTime = JSON.parse(
      execSync(
        `npx tsx /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/gtm-report-range.ts --start "${dateFromTime(agendaStatus.start_time)}" --end "${dateFromTime(agendaStatus.end_time)}" "trello-label: ${agendaStatus.label}" | tail -n 1 | jq`,
        { encoding: "utf8" },
      ),
    );
    gtmStatus = `\u2699  ${currentTimeBlockCommittedTime.totalDuration} (${((hmsToHours(currentTimeBlockCommittedTime.totalDuration) / agendaStatus.duration) * 100).toPrecision(2)}%)`;
  }
}

function renderStatus() {
  status = [renderAgendaStatus(), gtmStatus]
    .filter((e) => e.length)
    .join(" | ");
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
