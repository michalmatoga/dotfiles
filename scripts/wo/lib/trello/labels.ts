import { trelloRequest } from "./client";

export type TrelloLabel = {
  id: string;
  name: string;
  color: string | null;
};

export const fetchBoardLabels = async (boardId: string): Promise<TrelloLabel[]> =>
  trelloRequest<TrelloLabel[]>(`boards/${boardId}/labels`, { fields: "name,color" });

export const createLabel = async (options: {
  boardId: string;
  name: string;
  color?: string;
}): Promise<TrelloLabel> =>
  trelloRequest<TrelloLabel>(
    "labels",
    { name: options.name, color: options.color ?? "blue", idBoard: options.boardId },
    { method: "POST" },
  );
