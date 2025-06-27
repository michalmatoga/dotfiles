
import { execSync } from "node:child_process";
import readline from "readline/promises";

const csvPath = "/mnt/g/My\\ Drive/march.csv";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const dwpTarget = 260;
const dwwTarget = 390;
const csvContent = execSync(`cat ${csvPath}`).toString().trim().split("\n").map((line: string) => line.split(";"));


(async function main() {
  console.log("Work Startup Ritual\n\nDWP\n");

  const remainingWorkdays = calculateRemainingWorkdays();

  const dwpToDate = sumHours(csvContent, 3);
  const dailyDwpTarget = Number(((dwpTarget - dwpToDate) / remainingWorkdays).toFixed(2));
  console.log({ dwpToDate, dwpTarget, dailyDwpTarget });

  const dwpi = await rl.question("How many hours do you intend to dedicate to DWP today?\n");


  console.log("\nDWW\n\n");
  const dwwToDate = sumHours(csvContent, 4);
  const dailyDwwTarget = Number(((dwwTarget - dwwToDate) / remainingWorkdays).toFixed(2));
  console.log({ dwwToDate, dwwTarget, dailyDwwTarget });

  const dwwi = await rl.question("How many hours do you intend to dedicate to DWW today?\n");
  rl.close();
  const entry = `${new Date().toISOString().split("T")[0]};0${dwpi}:00:00;0${dwwi}:00:00`;

  const content = execSync(`cat ${csvPath} | grep -v "$(date +%Y-%m-%d)"`).toString().trim().split("\n");
  console.log(entry);

  execSync(`echo "${[entry, ...content].join("\n")}" > ${csvPath}`);
})();

function calculateRemainingWorkdays() {
  const today = new Date();
  const endOfYear = new Date(today.getFullYear(), 11, 31);
  let workdays = 0;

  for (let day = new Date(today); day <= endOfYear; day.setDate(day.getDate() + 1)) {
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    if (!isWeekend) {
      workdays++;
    }
  }

  return workdays;
}

function convertToHours(time: string): number {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours + minutes / 60 + seconds / 3600;
}

function sumHours(csvContent: string[][], column: number): number {
  return csvContent.reduce((sum, line) => {
    return sum + convertToHours(line[column] || "00:00:00");
  }, 0);
}

