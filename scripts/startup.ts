
import { execSync } from "node:child_process";
import readline from "readline/promises";

const csvPath = "/mnt/g/My\\ Drive/march.csv";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

(async function main() {
  console.log("Work Startup Ritual\n");

  const dwpi = await rl.question("How many hours do you intend to dedicate to DWP today?\n");
  const dwwi = await rl.question("How many hours do you intend to dedicate to DWW today?\n");
  rl.close();
  const entry = `${new Date().toISOString().split("T")[0]};0${dwpi}:00:00;0${dwwi}:00:00`;

  const content = execSync(`cat ${csvPath} | grep -v "$(date +%Y-%m-%d)"`).toString().trim().split("\n");
  console.log(entry);
  execSync(`echo "${[entry, ...content].join("\n")}" > ${csvPath}`);
})();
