import { trelloRequest } from "./client";

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idLabels: string[];
  idList: string;
  url?: string;
  shortUrl?: string;
};

export const fetchBoardCards = async (boardId: string): Promise<TrelloCard[]> =>
  trelloRequest<TrelloCard[]>(`boards/${boardId}/cards`, {
    fields: "name,desc,idLabels,idList,shortUrl,url",
  });

export const createCard = async (options: {
  listId: string;
  name: string;
  desc?: string;
  labelIds?: string[];
}): Promise<TrelloCard> =>
  trelloRequest<TrelloCard>(
    "cards",
    {
      idList: options.listId,
      name: options.name,
      desc: options.desc ?? "",
      idLabels: options.labelIds?.join(",") ?? undefined,
    },
    { method: "POST" },
  );

export const updateCard = async (options: {
  cardId: string;
  name?: string;
  desc?: string;
  listId?: string;
  labelIds?: string[];
  pos?: string | number;
}): Promise<TrelloCard> =>
  trelloRequest<TrelloCard>(
    `cards/${options.cardId}`,
    {
      name: options.name,
      desc: options.desc,
      idList: options.listId,
      idLabels: options.labelIds ? options.labelIds.join(",") : undefined,
      pos: options.pos,
    },
    { method: "PUT" },
  );
