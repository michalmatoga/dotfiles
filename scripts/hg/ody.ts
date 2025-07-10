import { writeFileSync } from "node:fs";
import { gtmReportTime } from "./lib/gtm";
import { hoursToHms } from "./lib/time";
import { execSync } from "node:child_process";

let agendaStatus = "⏸️ ";
let gtmStatus = { dww: "00:00:00", dwp: "00:00:00" };
let status = "";

(async function main() {
  runWithInterval(gtm, 60000);
  runWithInterval(agenda, 60000);
  runWithInterval(renderStatus, 1000);
})();

function agenda() {
  const res = JSON.parse(
    execSync(
      `gcalcli --calendar LSS agenda "$(date '+%Y-%m-%d %H:%M')" "$(date -d '+10 minutes' '+%Y-%m-%d %H:%M')" --tsv --details "description" | csvjson | jq`,
      { encoding: "utf8" },
    ),
  );
  if (res.length) {
    const e = res[0];
    const endTime = e.end_time.split(":").slice(1, 3);
    const now = new Date();
    const endDateTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      endTime[0],
      endTime[1],
    );
    const remainingHours =
      (Date.parse(endDateTime.toISOString()) - Date.parse(now.toISOString())) /
      3600000;

    agendaStatus = `${e.title} ▶️ ${endTime.join(":")} ⌛ ${hoursToHms(remainingHours)}`;
  } else {
    agendaStatus = "⏸️ ";
  }
}

function gtm() {
  const dww = hoursToHms(gtmReportTime("dww"));
  const dwp = hoursToHms(gtmReportTime("dwp"));
  gtmStatus = { dww, dwp };
}

function renderStatus() {
  const { dww, dwp } = gtmStatus;
  status = `${agendaStatus} | W${dww} | P${dwp}`;
  return writeFileSync(`${process.env.HOME}/.ody`, status);
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
