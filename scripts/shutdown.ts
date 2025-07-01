import { execSync } from "node:child_process";
import readline from "readline/promises";

const csvPath = "/mnt/g/My\\ Drive/march.csv";
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async function main() {
  console.log("Work Shutdown Ritual\n");

  console.log(
    `Here's the summary of your Deep Work for today:\n\n${" ".repeat(48)}DWP\n\n`,
  );
  execSync("gtm report -today -format timeline-hours -tags dwp", {
    stdio: "inherit",
  });
  execSync(
    "gtm report -format summary -today -tags dwp | tac | sed '2d' | head -n -2",
    { stdio: "inherit" },
  );
  console.log(`\n\n${" ".repeat(48)}DWW\n\n`);
  execSync("gtm report -today -format timeline-hours -tags dww", {
    stdio: "inherit",
  });
  execSync(
    "gtm report -format summary -today -tags dww | tac | sed '2d' | head -n -2",
    { stdio: "inherit" },
  );

  const rating = await rl.question("How do you feel about today (-2:+2)?\n");
  const notes = await rl.question("Any notes?\n");
  rl.close();

  const journalDir = "/home/nixos/ghq/gitlab.com/michalmatoga/journal";
  const dateToday = new Date();
  const formattedDate = dateToday.toISOString().split("T")[0];
  const formattedTime = dateToday.toTimeString().split(" ")[0].slice(0, 5);
  const entry = `- ${formattedDate} ${formattedTime},[[d-esm]],${rating},\\"${notes}\\"`;
  execSync(`echo "${entry}" >> ${journalDir}/${formattedDate}.md`);
})();

function addDurations(reportTime: string[]): string {
  let totalHours = 0,
    totalMinutes = 0,
    totalSeconds = 0;

  const parseTime = (timeArray: string[]) => {
    let hours = 0,
      minutes = 0,
      seconds = 0;
    timeArray.forEach((time) => {
      if (time.endsWith("h")) {
        hours += parseInt(time);
      } else if (time.endsWith("m")) {
        minutes += parseInt(time);
      } else if (time.endsWith("s")) {
        seconds += parseInt(time);
      }
    });
    return { hours, minutes, seconds };
  };

  const totalTime = parseTime(reportTime);

  totalSeconds = totalTime.seconds;
  totalMinutes = totalTime.minutes + Math.floor(totalSeconds / 60);
  totalHours = totalTime.hours + Math.floor(totalMinutes / 60);

  totalSeconds = totalSeconds % 60;
  totalMinutes = totalMinutes % 60;

  return `${String(totalHours).padStart(2, "0")}:${String(totalMinutes).padStart(2, "0")}:${String(totalSeconds).padStart(2, "0")}`;
}

function reportForTag(tag: string) {
  const reportTime = execSync(
    `gtm report -today -format summary -tags ${tag} | tail -n 2 | head -n 1`,
    {
      stdio: ["inherit"],
    },
  )
    .toString()
    .split(" ")
    .filter((e: string) => e.match(/\d(h|m|s)$/));
  return addDurations(reportTime);
}
