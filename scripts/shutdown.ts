import { execSync } from "node:child_process";
import readline from "readline/promises";

(async function main() {
  console.log("Work Shutdown Ritual");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const rating = await rl.question("How do you feel about today (-2:+2)?\n");
  const notes = await rl.question("Any notes?\n");
  rl.close();
  const entry = `${new Date().toISOString().split("T")[0]};${reportForTag("dwp")};${reportForTag("dww")};${rating};"${notes}"`

  const csvPath = "/mnt/g/My\\ Drive/march.csv";
  const content = execSync(`cat ${csvPath} | grep -v "$(date +%Y-%m-%d)"`).toString().trim().split("\n");
  console.log([entry, ...content].join("\n"));
  execSync(`echo "${[entry, ...content].join("\n")}" > ${csvPath}`);
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
  // TODO: add -today
  const reportTime = execSync(`gtm report -format summary -tags ${tag} | tail -n 2 | head -n 1`, {
    stdio: ["inherit"]
  }).toString().split(" ").filter((e: string) => e.match(/\d(h|m|s)$/));
  return addDurations(reportTime);
}
