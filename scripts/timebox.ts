import { readFileSync } from "fs";
import { execSync } from "node:child_process";

const tagsFilter = process.argv[2] || "";
const limitHours = Number(process.argv[3] || readLimitHoursFromCsv(tagsFilter) || "2");

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


  const message = `📝 ${tagsFilter.toUpperCase()}: ${await getFirstCardInDoingList()}\n📊 ${formatTime(reportTime)} | ▶️ ${formatTime(statusTime)} | ⌛ ${totalDuration} / ${limitHours}h (${percentageUsed.toFixed(0)}%)`;
  console.clear();
  if (percentageUsed > 100) {
    console.log(`\x1b[31mOVERCOMMITTING ON ${tagsFilter.toUpperCase()} (${percentageUsed.toFixed(0)}%)\x1b[0m`);
    execSync(`bash ${process.cwd()}/scripts/nag.sh`);
    return;
  }

  console.log(message);
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
      let appetiteSummary = "";
      const a = getTimeInvested(cards[0].shortLink);
      const b = await getTrelloAppetite(cards[0].shortLink);
      if (b) {
        appetiteSummary = `[🍴 ${a.toPrecision(2)}/${b}h (${(a / b * 100).toPrecision(2)}%)]`;
      }
      const cardName = [appetiteSummary, cards[0].name].join(" ");

      const checklistsResponse = await fetch(`https://api.trello.com/1/cards/${cards[0].id}/checklists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
      const checklists = await checklistsResponse.json();

      if (checklists.length > 0 && checklists[0].checkItems.length > 0) {
        const firstChecklistItem = checklists[0].checkItems.filter(({ state }) => state === 'incomplete').sort((a: any, b: any) => a.pos - b.pos)[0].name;
        return `${cardName}\n   ▶️ ${firstChecklistItem}`;
      } else {
        return `${cardName}`;
      }
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

function readLimitHoursFromCsv(tagsFilter: string) {
  if (!tagsFilter) {
    return;
  }

  const csvPath = "/mnt/g/My\\ Drive/march.csv";
  const index = (tagsFilter === 'dwp') ? 1 : 2;
  const content = execSync(`head -n 1 ${csvPath}`).toString().split(";");
  return content[index][1]
}

async function getTrelloAppetite(cardId: string): Promise<number | null> {
  const appetiteFieldId = '685ce60b9f2be1fd2c204094';
  const url = `https://api.trello.com/1/cards/${cardId}/customFieldItems?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const appetiteField = data.find((field: any) => field.idCustomField === appetiteFieldId);
    return appetiteField ? Number(appetiteField.value.number) : null;
  } catch (error) {
    console.error('Error fetching Trello custom field:', error);
    return null;
  }
}

function getTimeInvested(cardId: string) {
  // TODO: make this work for GHEC as well
  return timeToHrs(execSync(`git log --grep https://trello.com/c/${cardId} --pretty=%H | gtm report -format summary`, { encoding: "utf-8" }).trim().split("\n").at(-1).trim());
}

function timeToHrs(time: string): number {
  return time.trim().split(" ").filter((entry: string) => entry.length).map((entry: string) => (entry.endsWith("h")) ? Number(entry.slice(0, -1)) : (entry.endsWith("m")) ? Number(entry.slice(0, -1)) / 60 : Number(entry.slice(0, -1)) / 3600).reduce((p: number, c: number) => p += c, 0);
}
