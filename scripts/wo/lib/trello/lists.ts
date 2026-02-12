import { trelloRequest } from "./client";

export type TrelloList = {
  id: string;
  name: string;
};

export const fetchBoardLists = async (boardId: string): Promise<TrelloList[]> =>
  trelloRequest<TrelloList[]>(`boards/${boardId}/lists`, { fields: "name" });

export const createList = async (options: {
  boardId: string;
  name: string;
}): Promise<TrelloList> =>
  trelloRequest<TrelloList>(
    "lists",
    { name: options.name, idBoard: options.boardId },
    { method: "POST" },
  );
