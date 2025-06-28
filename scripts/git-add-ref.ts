import { execSync } from "node:child_process";
import { readFileSync } from "fs";

const secrets = JSON.parse(readFileSync(`${__dirname}/../secrets.json`, "utf-8"));
const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;


(async function main() {
  const gitRemote = execSync('git remote -v | head -n 1', { encoding: "utf-8" });

  const reference = (gitRemote.includes("schibsted")) ? await getGhecReference() : await getTrelloReference();
  if (reference) {
    execSync(`git interpret-trailers --in-place --trailer "Refs: ${reference}" ${process.argv[2]}`);
  }
})();

async function getTrelloReference() {
  const card = await getTrelloFirstDoingCard();
  if (card) {
    return card.shortUrl;
  }
  return undefined;
}

async function getGhecReference() {
  const card = await getTrelloFirstDoingCard();
  if (card) {
    if (card) {
      const match = Array.from(new Set(card.desc.match(/https?:\/\/[^\s\]]+/g)));
      if (match) {
        return match.join(" ")
      }
    }
  }
  return undefined;
}

async function getTrelloFirstDoingCard() {
  try {
    const response = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    const lists = await response.json();

    const doingList = lists.find((list: any) => list.name.toLowerCase() === 'doing');
    if (!doingList) {
      return undefined;
    }

    const cardsResponse = await fetch(`https://api.trello.com/1/lists/${doingList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    const cards = await cardsResponse.json();

    if (cards.length > 0) {
      return cards[0];
    }
    return undefined;
  } catch (error) {
    console.error('Error fetching Trello data:', error);
  }
}
