import { writeFileSync } from "node:fs";

let status = "";
(async function main() {
  setInterval(renderStatus, 1000);
  setInterval(() => {
    status = new Date().toISOString();
    console.log({ status });
  }, 1000);
})();

function renderStatus() {
  return writeFileSync(`${process.env.HOME}/.ody`, status);
}

process.on("SIGINT", () => {
  status = "STOPPED";
  renderStatus();
  process.exit();
});

process.on("SIGTERM", () => {
  status = "STOPPED";
  renderStatus();
  process.exit();
});

process.on("unhandledRejection", (error) => {
  status = `ERROR: ${error}`;
  renderStatus();
});
