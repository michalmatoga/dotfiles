import { execSync } from "child_process";
import readline from "readline";

const [, , pomoMin, breakMin] = process.argv;

const pomoStart = new Date();
const pomoDuration = parseInt(pomoMin, 10) * 60 * 1000;
let elapsedTime = 0;

const pomoInterval = setInterval(() => {
  const now = new Date();
  elapsedTime = now.getTime() - pomoStart.getTime();
  const remainingTime = pomoDuration - elapsedTime;

  if (remainingTime <= 0) {
    clearInterval(pomoInterval);
    execSync(`bash ${__dirname}/nag.sh`, { stdio: "inherit" });
    rl.close();
  } else {
    const minutes = Math.floor(remainingTime / (60 * 1000));
    const seconds = Math.floor((remainingTime % (60 * 1000)) / 1000);
    console.clear();
    console.log(
      `\x1b[32mFOCUS ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`.padStart(
        70,
        " ",
      ),
    );
  }
}, 1000);

// TODO: implement breaks
