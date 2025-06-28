import { execSync } from "node:child_process";
import readline from "readline/promises";

const csvPath = "/mnt/g/My\\ Drive/march.csv";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

(async function main() {
  console.log("Work Shutdown Ritual\n");

  console.log(`Here's the summary of your Deep Work for today:\n\n${' '.repeat(48)}DWP\n\n`);
  execSync("gtm report -today -format timeline-hours -tags dwp", { stdio: "inherit" });
  execSync("gtm report -format summary -today -tags dwp | tac | sed '2d' | head -n -2", { stdio: "inherit" });
  console.log(`\n\n${' '.repeat(48)}DWW\n\n`);
  execSync("gtm report -today -format timeline-hours -tags dww", { stdio: "inherit" });
  execSync("gtm report -format summary -today -tags dww | tac | sed '2d' | head -n -2", { stdio: "inherit" });

  const rating = await rl.question("How do you feel about today (-2:+2)?\n");
  const notes = await rl.question("Any notes?\n");
  rl.close();
  const dateToday = new Date().toISOString().split("T")[0];


  const content = execSync(`cat ${csvPath}`).toString().trim().split("\n");
  const todaysEntry = content.find((e: string) => e.startsWith(dateToday));
  const contentWithoutTodaysEntry = content.filter((e: string) => !e.startsWith(dateToday));
  if (!todaysEntry) {
    console.error("No entry for today found. Did you forget to run startup script?");
    process.exit(1);
  }

  const updatedTodaysEntry = `${todaysEntry.split(";").slice(0, 3).join(";")};${reportForTag("dwp")};${reportForTag("dww")};${rating};"${notes}"`
  console.log(updatedTodaysEntry);
  execSync(`echo "${[updatedTodaysEntry, ...contentWithoutTodaysEntry].join("\n")}" > ${csvPath}`);
})();


function addDurations(reportTime: string[]): string {
  let totalHours = 0, totalMinutes = 0, totalSeconds = 0;

  const parseTime = (timeArray: string[]) => {
    let hours = 0, minutes = 0, seconds = 0;
    timeArray.forEach(time => {
      if (time.endsWith('h')) {
        hours += parseInt(time);
      } else if (time.endsWith('m')) {
        minutes += parseInt(time);
      } else if (time.endsWith('s')) {
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

  return `${String(totalHours).padStart(2, '0')}:${String(totalMinutes).padStart(2, '0')}:${String(totalSeconds).padStart(2, '0')}`;
}

function reportForTag(tag: string) {
  const reportTime = execSync(`gtm report -today -format summary -tags ${tag} | tail -n 2 | head -n 1`, {
    stdio: ["inherit"]
  }).toString().split(" ").filter((e: string) => e.match(/\d(h|m|s)$/));
  return addDurations(reportTime);
}
