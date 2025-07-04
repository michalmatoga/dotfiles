import { readFileSync } from "fs";

const secrets = JSON.parse(
  readFileSync(`${__dirname}/../../../secrets.json`, "utf-8"),
);

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;

export async function getFirstCardInDoingList() {
  try {
    const response = await fetch(
      `https://api.trello.com/1/boards/${BOARD_ID}/lists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
    );
    const lists = await response.json();

    const doingList = lists.find(
      (list: any) => list.name.toLowerCase() === "doing",
    );
    if (!doingList) {
      return 'No "Doing" list found.';
    }

    const cardsResponse = await fetch(
      `https://api.trello.com/1/lists/${doingList.id}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
    );
    const cards = await cardsResponse.json();

    if (cards.length > 0) {
      const cardName = cards[0].name;

      const checklistsResponse = await fetch(
        `https://api.trello.com/1/cards/${cards[0].id}/checklists?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`,
      );
      const checklists = await checklistsResponse.json();

      if (checklists.length > 0 && checklists[0].checkItems.length > 0) {
        const filteredChecklistItems = checklists[0].checkItems
          .filter(({ state }) => state === "incomplete")
          .sort((a: any, b: any) => a.pos - b.pos);
        if (filteredChecklistItems.length) {
          return `- [ ] ${filteredChecklistItems[0].name}`;
        }
      }
      return `📝 ${cardName}`;
    } else {
      // red: "#[fg=red]",
      // green: "#[fg=green]",
      // reset: "#[fg=default]",
      return "#[fg=red]⚠️ no task#[fg=default]";
    }
  } catch (error) {
    console.error("Error fetching Trello data:", error);
  }
}
