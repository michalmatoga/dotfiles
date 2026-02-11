import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  dateFromTime,
  dateToLocaleTimestamp,
  hmsToHours,
  hoursToHm,
  hoursToHms,
} from "./lib/time";
import {
  getCardMoveActionsSince,
  getFirstCardInDoingList,
  moveFirstCardInDoingListToReady,
} from "./lib/trello";

interface AgendaStatus {
  title: string;
  start_time: string;
  end_time: string;
  duration: number;
  description: string;
  label: string;
  card: Record<string, any> | undefined;
}

const dataFile = "/mnt/g/My\ Drive/hourglass.csv";

let agendaStatus: AgendaStatus | undefined = undefined;
let gtmStatus = "";
let status = "";
let lastActionsCheck: Date | undefined = undefined;

const gitRemoteOk = (root: string) => {
  try {
    return execSync("git remote -v", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .includes("git@github.com:michalmatoga/dotfiles.git");
  } catch {
    return false;
  }
};

const dotfilesDir = (() => {
  const value = process.env.DOTFILES_DIR;
  if (!value) {
    throw new Error("DOTFILES_DIR is required");
  }
  if (!gitRemoteOk(value)) {
    throw new Error("DOTFILES_DIR is required (dotfiles remote not found)");
  }
  return value;
})();

(async function main() {
  runWithInterval(checkActions, 10000);
  runWithInterval(fetchAgendaStatus, 60000);
  runWithInterval(fetchGtmStatus, 60000);
  runWithInterval(renderStatus, 1000);
  // runWithInterval(syncUtilization, 3600000);
})();

async function checkActions() {
  if (!lastActionsCheck) {
    const dataContent = readFileSync(dataFile, { encoding: "utf8" });
    const lastDate = dataContent
      .split("\n")
      .reverse()
      .find((line) => line.includes("[[d-bst]]"))
      ?.split(",")[0];
    if (lastDate) {
      lastActionsCheck = new Date(new Date(lastDate).getTime() + 60000);
    } else {
      lastActionsCheck = new Date(new Date().setHours(0, 0, 0, 0));
    }
  }

  const moveActions = await getCardMoveActionsSince(lastActionsCheck);
  if (!moveActions.length) {
    lastActionsCheck = new Date();
    return;
  }
  lastActionsCheck = new Date(moveActions.at(-1).date);

  const dataPoints = moveActions.map(
    ({ date, listAfter, card: { id, name, labels } }) =>
      [
        dateToLocaleTimestamp(new Date(date)),
        "[[d-bst]]",
        id,
        name,
        labels,
        listAfter,
      ].join(","),
  );
  writeFileSync(dataFile, dataPoints.join("\n").concat("\n"), {
    flag: "a",
  });
}

function syncUtilization() {
  const date = new Date().toISOString().split("T")[0];
  const timestamp = `${date} ${new Date().toTimeString().slice(0, 5)}`;
  const start = `${date} 00:00`;
  const end = `${date} 23:59`;

  const areas = ["dwp", "dww"];
  const utilizationData: string[] = [];
  for (const area of areas) {
    const { totalDuration } = JSON.parse(
      execSync(
        `gcalcli --calendar LSS search "${area}" "${start}" "${end}" --tsv --details "description" | npx tsx "${dotfilesDir}/scripts/cq.ts" | jq '{totalDuration: [.[].duration] | add}'`,
        { encoding: "utf8" },
      ),
    );
    const { totalDuration: utilization } = JSON.parse(
      execSync(
        `npx tsx "${dotfilesDir}/scripts/gtm-report-range.ts" --start "${start}" --end "${end}" "trello-label: ${area}" | tail -n 1 | jq`,
        { encoding: "utf8" },
      ),
    );
    utilizationData.push(
      [timestamp, `[[d-${area}]]`, utilization, hoursToHm(totalDuration)].join(
        ",",
      ),
    );
  }
  writeFileSync(dataFile, utilizationData.join("\n").concat("\n"), {
    flag: "a",
  });
  console.log("synced utilization", { utilizationData });
}

async function fetchAgendaStatus() {
  const res = JSON.parse(
    execSync(
      `gcalcli --calendar LSS agenda "$(date '+%Y-%m-%d %H:%M')" "$(date -d '+10 minutes' '+%Y-%m-%d %H:%M')" --tsv --details "description" | npx tsx "${dotfilesDir}/scripts/cq.ts" | jq`,
      { encoding: "utf8" },
    ),
  ) as AgendaStatus[];

  if (res.length) {
    if (!agendaStatus) {
      agendaStatus = { ...res[0], label: "", card: undefined };
    }
    const labelMatch = agendaStatus?.description.match(/>.*label:([^<]+)<\/a>/);
    if (labelMatch) {
      agendaStatus.label = decodeURI(labelMatch[1]);
      const trelloRes = await getFirstCardInDoingList();
      if (trelloRes) {
        if (trelloRes.labels.find(({ name }) => name === agendaStatus?.label)) {
          trelloRes.startTime = getCardStartTime(trelloRes);
          agendaStatus.card = trelloRes;
        } else {
          agendaStatus.card = undefined;
          await moveFirstCardInDoingListToReady();
        }
      }
    }
  } else {
    agendaStatus = undefined;
  }
}

function getCardStartTime(card: { id: string }) {
  try {
    const startTime = execSync(
      `cat /mnt/g/My\\ Drive/hourglass.csv | rg -F '[[d-bst]]' | rg '${card.id}' | rg 'Doing' | head -n 1 | csvjson -H | jq -r '.[].a'`,
      { encoding: "utf-8" },
    );
    return new Date(startTime.trim());
  } catch (error) {
    return undefined;
  }
}

function renderAgendaStatus() {
  if (!agendaStatus) {
    return "#[fg=yellow]💤🌴";
  }
  if (agendaStatus.card) {
    const cycleTime = renderCycleTime(agendaStatus.card);
    return `${agendaStatus.card.name}${cycleTime} | ⌛ ${remainingHms(agendaStatus).slice(0, -3)} / ${hoursToHm(agendaStatus.duration)}`;
  }
  return `#[fg=red]⛔ No card in progress matching ${agendaStatus.title} / ${agendaStatus.label}`;
}

function renderCycleTime(card: Record<string, any>) {
  if (!card.startTime) {
    return "";
  }
  return ` | ⏱️  ${hoursToHm((new Date().getTime() - card.startTime.getTime()) / 3600000)}`;
}

function fetchGtmStatus() {
  gtmStatus = "";
  if (agendaStatus && agendaStatus.card) {
    const currentTimeBlockCommittedTime = JSON.parse(
      execSync(
        `npx tsx "${dotfilesDir}/scripts/gtm-report-range.ts" --start "${dateFromTime(agendaStatus.start_time)}" --end "${dateFromTime(agendaStatus.end_time)}" "trello-label: ${agendaStatus.label}" | tail -n 1 | jq`,
        { encoding: "utf8" },
      ),
    );
    let cardTouchTime: { totalDuration: string } | undefined = undefined;
    cardTouchTime = JSON.parse(
      execSync(
        `npx tsx "${dotfilesDir}/scripts/gtm-report-range.ts" "trello-label: ${agendaStatus.card.name}" | tail -n 1 | jq`,
        { encoding: "utf8" },
      ),
    );
    gtmStatus = `\u2699  ${currentTimeBlockCommittedTime.totalDuration} (${((hmsToHours(currentTimeBlockCommittedTime.totalDuration) / agendaStatus.duration) * 100).toPrecision(2)}%)${cardTouchTime ? ` | 👋  ${cardTouchTime.totalDuration}` : ""}`;
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
