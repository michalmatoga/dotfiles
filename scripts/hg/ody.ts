import { writeFileSync } from "node:fs";
import { gtmReportTime } from "./lib/gtm";
import { hoursToHms } from "./lib/time";

let status = "";
(async function main() {
  gtm();
  setInterval(renderStatus, 1000);
  setInterval(gtm, 60000);
})();

function gtm() {
  const dww = hoursToHms(gtmReportTime("dww"));
  const dwp = hoursToHms(gtmReportTime("dwp"));
  status = `W${dww}|P${dwp}`;
}

function renderStatus() {
  return writeFileSync(`${process.env.HOME}/.ody`, status);
}

process.on("SIGINT", () => {
  status = "#[fg=red]STOPPED";
  renderStatus();
  process.exit();
});

process.on("SIGTERM", () => {
  status = "#[fg=red]STOPPED";
  renderStatus();
  process.exit();
});

process.on("unhandledRejection", (error) => {
  status = `ERROR: ${error}`;
  renderStatus();
});
