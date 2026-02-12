import { trelloRequest } from "./client";

export type TrelloBoard = {
  id: string;
  name: string;
  idOrganization?: string | null;
  url?: string;
};

export const fetchBoardByShortLink = async (shortLink: string): Promise<TrelloBoard> =>
  trelloRequest<TrelloBoard>(`boards/${shortLink}`, { fields: "name,idOrganization,url" });

export const createBoard = async (options: {
  name: string;
  idOrganization?: string | null;
  permissionLevel?: "org" | "private" | "public";
}): Promise<TrelloBoard> =>
  trelloRequest<TrelloBoard>(
    "boards",
    {
      name: options.name,
      idOrganization: options.idOrganization ?? undefined,
      prefs_permissionLevel: options.permissionLevel ?? "org",
      defaultLists: false,
    },
    { method: "POST" },
  );
