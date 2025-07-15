import { execSync } from "node:child_process";

(async function main() {
  let data = "";

  process.stdin.on("data", (chunk) => {
    data += chunk; // Append chunk to data
  });

  process.stdin.on("end", () => {
    const res = JSON.parse(
      execSync(`csvjson`, {
        input: data,
        encoding: "utf8",
      }),
    ).filter(({ title }) => title !== null);

    const resWithDuration = res.map((entry: any) => ({
      ...entry,
      ...calculateDuration(entry.start_time, entry.end_time),
    }));

    process.stdout.write(JSON.stringify(resWithDuration));
  });
})();

function calculateDuration(startTime: string, endTime: string) {
  const start_time = startTime.substring(startTime.indexOf(":") + 1);
  const end_time = endTime.substring(endTime.indexOf(":") + 1);
  const start = Date.parse(`1970-01-01T${start_time}Z`);
  const end = Date.parse(`1970-01-01T${end_time}Z`);
  const durationMs = end - start;

  const duration = (durationMs / (1000 * 60 * 60)) % 24;

  return { start_time, end_time, duration };
}
