import { trelloRequest } from "./client";

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idLabels: string[];
  idList: string;
  due?: string | null;
  dueComplete?: boolean;
  closed?: boolean;
  url?: string;
  shortUrl?: string;
};

export type TrelloChecklistItem = {
  id: string;
  name: string;
  state: "incomplete" | "complete";
  pos: number;
};

export type TrelloChecklist = {
  id: string;
  name: string;
  checkItems: TrelloChecklistItem[];
};

export type TrelloCardLabel = {
  id: string;
  name: string;
  color: string | null;
};

export type TrelloCardDetails = {
  id: string;
  name: string;
  desc: string;
  url: string;
  shortUrl: string;
  labels: TrelloCardLabel[];
  checklists: TrelloChecklist[];
};

export const fetchBoardCards = async (boardId: string): Promise<TrelloCard[]> =>
  trelloRequest<TrelloCard[]>(`boards/${boardId}/cards`, {
    fields: "name,desc,idLabels,idList,shortUrl,url,due,dueComplete",
  });

export const fetchBoardCardsAll = async (boardId: string): Promise<TrelloCard[]> =>
  trelloRequest<TrelloCard[]>(`boards/${boardId}/cards`, {
    fields: "name,desc,idLabels,idList,shortUrl,url,due,dueComplete,closed",
    filter: "all",
  });

export const fetchCardDetailsByShortId = async (shortId: string): Promise<TrelloCardDetails> =>
  trelloRequest<TrelloCardDetails>(`cards/${shortId}`, {
    fields: "name,desc,url,shortUrl",
    labels: "all",
    label_fields: "name,color",
    checklists: "all",
    checklist_fields: "name",
    checkItem_fields: "name,state,pos",
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
  due?: string | null;
  listId?: string;
  labelIds?: string[];
  pos?: string | number;
  closed?: boolean;
}): Promise<TrelloCard> =>
  trelloRequest<TrelloCard>(
    `cards/${options.cardId}`,
    {
      name: options.name,
      desc: options.desc,
      due: options.due,
      idList: options.listId,
      idLabels: options.labelIds ? options.labelIds.join(",") : undefined,
      pos: options.pos,
      closed: options.closed,
    },
    { method: "PUT" },
  );
