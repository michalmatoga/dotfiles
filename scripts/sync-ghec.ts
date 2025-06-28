import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const secrets = JSON.parse(readFileSync(`${__dirname}/../secrets.json`, "utf-8"));

const TRELLO_API_KEY = secrets.trello_api_key;
const TRELLO_TOKEN = secrets.trello_token;
const BOARD_ID = secrets.trello_board_id;


(async function main() {
  const issues = JSON.parse(execSync('gh issue list --search "is:issue state:open archived:false assignee:@me sort:updated-desc org:svp" --json url,title,body', { encoding: 'utf-8' }));

  const trelloCards = await fetchTrelloCardsWithLabel(BOARD_ID, 'Praca w Schibsted');
  const newIssues = issues.filter((issue: { title: string }) => !trelloCards.some((card: { name: string }) => card.name === issue.title));

  const labelIds = (await fetchTrelloLabelIds(BOARD_ID, ['Praca w Schibsted']));
  for (const issue of newIssues) {
    await addTrelloCard(issue.title, `Refs: ${issue.url}\n\n${issue.body}`, labelIds);
  }
})();

async function addTrelloCard(name: string, body: string, labels: string[]) {
  try {
    const newListId = "6694f3249e46f9e9aec6db3b";
    const labelIds = labels.map(label => `&idLabels=${label}`).join('');
    const response = await fetch(`https://api.trello.com/1/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&idList=${newListId}&name=${encodeURIComponent(name)}&desc=${encodeURIComponent(body)}${labelIds}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to create Trello card');
    }

    const data = await response.json();
    console.log('Trello card created:', data.shortUrl);
  } catch (error) {
    console.error('Error creating Trello card:', error);
  }
}

async function fetchTrelloCardsWithLabel(boardId: string, label: string) {
  try {
    const response = await fetch(`https://api.trello.com/1/boards/${boardId}/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const data = (await response.json()).filter(({ labels }) => labels.find(({ name }) => name === label));
    return data;
  } catch (error) {
    console.error('Error fetching Trello cards:', error);
    return [];
  }
}

async function fetchTrelloLabelIds(boardId: string, labelNames: string[]): Promise<string[]> {
  try {
    const response = await fetch(`https://api.trello.com/1/boards/${boardId}/labels?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const labels = await response.json();
    const matchedLabels = labels.filter(({ name }) => labelNames.includes(name));
    return matchedLabels.map(({ id }) => id);
  } catch (error) {
    console.error('Error fetching Trello labels:', error);
    return [];
  }
}
