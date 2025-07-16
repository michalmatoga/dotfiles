import { readFileSync } from "fs";

const secrets = JSON.parse(
  readFileSync(`${__dirname}/../../../secrets.json`, "utf-8"),
);

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;
const DOING_LIST_ID = "668928577acb6ab04b723321";
const READY_LIST_ID = "6689284f81d51c086a80879c";
const DONE_LIST_ID = "68594f7ff9ed148379efc188";

export async function getFirstCardInDoingList() {
  const cardsResponse = await fetch(
    `https://api.trello.com/1/lists/${DOING_LIST_ID}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
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

export async function getDoingListActions() {
  const cardsResponse = await fetch(
    `https://api.trello.com/1/lists/${DOING_LIST_ID}/actions?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
  );
  return cardsResponse.json();
}

export async function getBoardActions() {
  const cardsResponse = await fetch(
    `https://api.trello.com/1/boards/${BOARD_ID}/actions?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&limit=1&filter=updateCard`,
  );
  return await cardsResponse.json();
}

export async function moveFirstCardInDoingListToReady() {
  const card = await getFirstCardInDoingList();
  if (!card) {
    return undefined;
  }
  const response = await fetch(
    `https://api.trello.com/1/cards/${card.id}?idList=${READY_LIST_ID}&pos=top&key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
    {
      method: "PUT",
    },
  );

  if (!response.ok) {
    throw new Error("Failed to move card to Ready list");
  }
  return response;
}
