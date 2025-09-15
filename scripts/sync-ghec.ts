import { execSync } from "child_process";
import { readFileSync } from "fs";

const secrets = JSON.parse(
  readFileSync(`${__dirname}/../secrets.json`, "utf-8"),
);

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;

const TRELLO_LABELS = {
  review: ["6694db7c23e5de7bec1b7489", "686cbf33add233ccba380f46"],
  issue: ["6694db7c23e5de7bec1b7489"],
};

process.env.GH_USER = "michal-matoga";
process.env.GH_HOST = "schibsted.ghe.com";

(async function main() {
  const issues = JSON.parse(
    execSync(
      'gh issue list --search "is:issue state:open archived:false assignee:@me sort:updated-desc" --json url,title,body',
      { encoding: "utf-8" },
    ),
  );

  const pullRequests = JSON.parse(
    execSync(
      'gh pr list --search "is:open archived:false sort:created-asc review-requested:@me org:svp" --json url,title,body',
      { encoding: "utf-8" },
    ),
  );

  const trelloCards = await fetchTrelloCardsWithLabel(
    BOARD_ID,
    "Praca w Schibsted",
  );

  const newIssues = issues.filter(
    (issue: { url: string }) =>
      !trelloCards.some(({ desc }) => desc.includes(`Refs: ${issue.url}`)),
  );
  const newPullRequests = pullRequests.filter(
    (pr: { url: string }) =>
      !trelloCards.some(({ desc }) => desc.includes(`Refs: ${pr.url}`)),
  );

  for (const pr of newPullRequests) {
    await addTrelloCard(
      pr.title,
      `Refs: ${pr.url}\n\n${pr.body}`,
      TRELLO_LABELS.review,
    );
  }
  for (const issue of newIssues) {
    await addTrelloCard(
      issue.title,
      `Refs: ${issue.url}\n\n${issue.body}`,
      TRELLO_LABELS.issue,
    );
  }
})();

async function addTrelloCard(name: string, body: string, labels: string[]) {
  try {
    const newListId = "6694f3249e46f9e9aec6db3b";
    const labelIds = labels.map((label) => `&idLabels=${label}`).join("");
    const response = await fetch(
      `https://api.trello.com/1/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&idList=${newListId}&name=${encodeURIComponent(name)}&desc=${encodeURIComponent(body)}${labelIds}`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error("Failed to create Trello card");
    }

    const data = await response.json();
    console.log("Trello card created:", data.shortUrl);
  } catch (error) {
    console.error("Error creating Trello card:", error);
  }
}

async function fetchTrelloCardsWithLabel(boardId: string, label: string) {
  try {
    const response = await fetch(
      `https://api.trello.com/1/boards/${boardId}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&filter=incomplete`,
    );
    if (!response.ok) {
      throw new Error("Network response was not ok");
    }
    const data = (await response.json()).filter(({ labels }) =>
      labels.find(({ name }) => name === label),
    );
    return data;
  } catch (error) {
    console.error("Error fetching Trello cards:", error);
    return [];
  }
}
