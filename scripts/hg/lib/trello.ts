import { readFileSync } from "fs";

const secrets = JSON.parse(
  readFileSync(`${__dirname}/../../../secrets.json`, "utf-8"),
);

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;
const LIST_ID = "668928577acb6ab04b723321";

export async function getFirstCardInDoingList() {
  const cardsResponse = await fetch(
    `https://api.trello.com/1/lists/${LIST_ID}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
  );
  const cards = await cardsResponse.json();

  if (cards.length > 0) {
    return cards[0];
  }
  return undefined;
}

export async function getLabelsFromFirstCardInDoingList() {
  try {
    const response = await fetch(
      `https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
    );
    const lists = await response.json();

    const doingList = lists.find(
      (list: any) => list.name.toLowerCase() === "doing",
    );
    if (!doingList) {
      return [];
    }

    const cardsResponse = await fetch(
      `https://api.trello.com/1/lists/${doingList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
    );
    const cards = await cardsResponse.json();

    if (cards.length > 0) {
      return cards[0].labels;
    }
  } catch (error) {
    console.error("Error fetching Trello data:", error);
  }
  return [];
}
