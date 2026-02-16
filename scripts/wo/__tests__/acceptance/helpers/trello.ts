import { trelloRequest } from "../../../lib/trello/client";

type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idLabels: string[];
  idList: string;
  url?: string;
  shortUrl?: string;
};

type TrelloList = {
  id: string;
  name: string;
};

// Track created cards for cleanup
const createdCardIds: string[] = [];

/**
 * Get the test board ID from environment.
 */
export const getTestBoardId = (): string => {
  const boardId = process.env.TRELLO_BOARD_ID_WO;
  if (!boardId) {
    throw new Error("TRELLO_BOARD_ID_WO not set in .env.test");
  }
  return boardId;
};

/**
 * Get lists on the test board.
 */
export const getTestLists = async (): Promise<TrelloList[]> => {
  const boardId = getTestBoardId();
  return trelloRequest<TrelloList[]>(`boards/${boardId}/lists`, {
    fields: "name",
  });
};

/**
 * Get a list ID by name.
 */
export const getListIdByName = async (name: string): Promise<string> => {
  const lists = await getTestLists();
  const list = lists.find((l) => l.name === name);
  if (!list) {
    throw new Error(`List "${name}" not found on test board`);
  }
  return list.id;
};

/**
 * Create a test card (will be cleaned up after test).
 */
export const createTestCard = async (options: {
  listName: string;
  name: string;
  desc?: string;
  labelIds?: string[];
}): Promise<TrelloCard> => {
  const listId = await getListIdByName(options.listName);

  const card = await trelloRequest<TrelloCard>(
    "cards",
    {
      idList: listId,
      name: `[TEST] ${options.name}`,
      desc: options.desc ?? "Created by acceptance test",
      idLabels: options.labelIds?.join(",") ?? undefined,
    },
    { method: "POST" },
  );

  createdCardIds.push(card.id);
  return card;
};

/**
 * Move a card to a different list.
 */
export const moveTestCard = async (cardId: string, listName: string): Promise<TrelloCard> => {
  const listId = await getListIdByName(listName);

  return trelloRequest<TrelloCard>(
    `cards/${cardId}`,
    { idList: listId },
    { method: "PUT" },
  );
};

/**
 * Delete a card.
 */
export const deleteCard = async (cardId: string): Promise<void> => {
  await trelloRequest<unknown>(`cards/${cardId}`, {}, { method: "DELETE" });
};

/**
 * Clean up all cards created during tests.
 * Called automatically after each test via setup.ts.
 */
export const cleanupTestCards = async (): Promise<void> => {
  for (const cardId of createdCardIds) {
    try {
      await deleteCard(cardId);
    } catch {
      // Ignore errors (card may already be deleted)
    }
  }
  createdCardIds.length = 0;
};

/**
 * Fetch all cards on the test board.
 */
export const fetchTestBoardCards = async (): Promise<TrelloCard[]> => {
  const boardId = getTestBoardId();
  return trelloRequest<TrelloCard[]>(`boards/${boardId}/cards`, {
    fields: "name,desc,idLabels,idList,shortUrl,url",
  });
};
