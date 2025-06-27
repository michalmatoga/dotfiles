import { readFileSync } from "fs";
import { execSync } from "node:child_process";

const tagsFilter = process.argv[2] || "";
const limitHours = Number(process.argv[3] || "2");

const secrets = JSON.parse(readFileSync(`${__dirname}/../secrets.json`, "utf-8"));

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;

(async function main() {
  await tick();
  setInterval(tick, 30000);
})();


async function tick() {
  const statusTime = execSync(`gtm status -tags ${tagsFilter} | tail -n 2 | head -n 1`).toString().split(" ").filter((e: string) => e.match(/\d(h|m|s)$/));
  const reportTime = execSync(`gtm report -today -format summary -tags ${tagsFilter} | tail -n 2 | head -n 1`, {
    stdio: ["inherit"]
  }).toString().split(" ").filter((e: string) => e.match(/\d(h|m|s)$/))

  const totalDuration = addDurations(statusTime, reportTime);

  const percentageUsed = calculatePercentageUsed(totalDuration, limitHours);

  console.log(`📝 ${await getFirstCardInDoingList()}`);
  console.log(`📊 ${formatTime(reportTime)} | ▶️ ${formatTime(statusTime)} | ⌛ ${totalDuration} / ${limitHours}h (${percentageUsed.toFixed(0)}%)`);
}


async function getFirstCardInDoingList() {
  try {
    const response = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    const lists = await response.json();

    const doingList = lists.find((list: any) => list.name.toLowerCase() === 'doing');
    if (!doingList) {
      return 'No "Doing" list found.';
    }

    const cardsResponse = await fetch(`https://api.trello.com/1/lists/${doingList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    const cards = await cardsResponse.json();

    if (cards.length > 0) {
      return `${cards[0].name}`;
    } else {
      return 'No cards in the "Doing" list.';
    }
  } catch (error) {
    console.error('Error fetching Trello data:', error);
  }
}

function formatTime(timeArray: string[]): string {
  let hours = 0, minutes = 0, seconds = 0;
  timeArray.forEach(time => {
    if (time.endsWith('h')) {
      hours = parseInt(time);
    } else if (time.endsWith('m')) {
      minutes = parseInt(time);
    } else if (time.endsWith('s')) {
      seconds = parseInt(time);
    }
  });
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function addDurations(timeArray1: string[], timeArray2: string[]): string {
  let totalHours = 0, totalMinutes = 0, totalSeconds = 0;

  const parseTime = (timeArray: string[]) => {
    let hours = 0, minutes = 0, seconds = 0;
    timeArray.forEach(time => {
      if (time.endsWith('h')) {
        hours = parseInt(time);
      } else if (time.endsWith('m')) {
        minutes = parseInt(time);
      } else if (time.endsWith('s')) {
        seconds = parseInt(time);
      }
    });
    return { hours, minutes, seconds };
  };

  const time1 = parseTime(timeArray1);
  const time2 = parseTime(timeArray2);

  totalSeconds = time1.seconds + time2.seconds;
  totalMinutes = time1.minutes + time2.minutes + Math.floor(totalSeconds / 60);
  totalHours = time1.hours + time2.hours + Math.floor(totalMinutes / 60);

  totalSeconds = totalSeconds % 60;
  totalMinutes = totalMinutes % 60;

  return `${String(totalHours).padStart(2, '0')}:${String(totalMinutes).padStart(2, '0')}:${String(totalSeconds).padStart(2, '0')}`;
}

function calculatePercentageUsed(totalDuration: string, limitHours: number): number {
  const [totalHours, totalMinutes, totalSeconds] = totalDuration.split(':').map(Number);
  const totalDurationInSeconds = totalHours * 3600 + totalMinutes * 60 + totalSeconds;
  const limitInSeconds = limitHours * 3600;

  return (totalDurationInSeconds / limitInSeconds) * 100;
}
