import { execSync } from "node:child_process";
import { queryCsv } from "./lib/csv-data";
import { gtmReportTime, gtmStatusTime } from "./lib/gtm";
import { hmsToHours, hoursToHms } from "./lib/time";
import { getFirstCardInDoingList } from "./lib/trello";

const yearlyTargets = { dwp: 300, dww: 450 };
let trelloCardData: string | undefined = "";

const dailyTargetOverride = process.argv[2];
const tag = process.cwd().includes("schibsted") ? "dww" : "dwp";

(async function main() {
  renderPreamble();
  await syncTrelloCardData();
  setInterval(render, 10000);
  setInterval(syncTrelloCardData, 60000);
})();

function renderPreamble() {
  const suggestedTarget = hoursToHms(calculateDailyTarget(tag));
  const timeSpent = hoursToHms(gtmReportTime(tag) + gtmStatusTime());

  console.log({ tag, suggestedTarget, timeSpent });
}

async function syncTrelloCardData() {
  trelloCardData = await getFirstCardInDoingList();
}

function render() {
  const dailyTarget = Number(dailyTargetOverride ?? calculateDailyTarget(tag));
  const timeLeft = dailyTarget - gtmReportTime(tag) - gtmStatusTime();
  const tick = `${tag} | 🚫 ${hoursToHms(dailyTarget)} | ${colorize(`⏳ ${hoursToHms(timeLeft)}`, timeLeft > 0 ? "green" : "red")}`;

  console.clear();
  console.log(tick);
  console.log(trelloCardData);
  if (timeLeft < 0) {
    execSync(
      `bash /home/nixos/ghq/github.com/michalmatoga/dotfiles/scripts/nag.sh `,
    );
  }
}

function colorize(input: string, color: string): string {
  const colors: { [key: string]: string } = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    reset: "\x1b[0m",
  };

  return `${colors[color] || colors.reset}${input}${colors.reset}`;
}

function calculateDailyTarget(tag: string) {
  const sumToDate = queryCsv(`d-${tag}]`)
    .map((r: string[]) => r[2])
    .reduce((prev: number, curr: string) => (prev += hmsToHours(curr)), 0);

  return (yearlyTargets[tag] - sumToDate) / workdaysUntilEndOfYear();
}

function workdaysUntilEndOfYear() {
  const today = new Date();
  const endOfYear = new Date(today.getFullYear(), 11, 31); // December 31st
  let weekdaysCount = 0;

  for (
    let day = new Date(today);
    day <= endOfYear;
    day.setDate(day.getDate() + 1)
  ) {
    const dayOfWeek = day.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Exclude Sundays (0) and Saturdays (6)
      weekdaysCount++;
    }
  }

  return weekdaysCount;
}
