import { createHash } from "node:crypto";

import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { listAliases, listNames } from "../policy/mapping";
import { extractDescriptionBase, formatSyncMetadata, parseSyncMetadata, updateDescriptionWithSync } from "./metadata";
import type { WorkItem } from "../normalize";
import { writeEvent } from "../state/events";
import { recordCardMove } from "../metrics/lifecycle";

const contentHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const moveClosedItemsToDone = async (options: {
  boardId: string;
  items: WorkItem[];
  verbose: boolean;
}) => {
  if (options.items.length === 0) {
    return;
  }

  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false, allowCreateLabels: true });
  const cards = await fetchBoardCards(options.boardId);
  const labelById = new Map(context.labels.map((label) => [label.id, label.name]));
  const doneList = context.listByName.get(listNames.done);
  if (!doneList) {
    throw new Error("Missing Done list in Trello board");
  }

  const cardByUrl = new Map<string, (typeof cards)[number]>();
  const cardByItemId = new Map<string, (typeof cards)[number]>();
  for (const card of cards) {
    const meta = parseSyncMetadata(card.desc);
    if (meta?.url) {
      cardByUrl.set(meta.url, card);
    }
    if (meta?.itemId) {
      cardByItemId.set(meta.itemId, card);
    }
  }

  for (const item of options.items) {
    const card = item.projectItemId
      ? cardByItemId.get(item.projectItemId) ?? cardByUrl.get(item.url)
      : cardByUrl.get(item.url);
    if (!card) {
      continue;
    }
    if (card.idList === doneList.id) {
      continue;
    }
    const base = extractDescriptionBase(card.desc);
    const meta = parseSyncMetadata(card.desc);
    const hash = meta?.contentHash ?? contentHash(base);
    const now = new Date().toISOString();
    const syncBlock = formatSyncMetadata({
      source: meta?.source ?? item.source,
      itemId: meta?.itemId ?? item.projectItemId ?? null,
      url: meta?.url ?? item.url,
      status: "done",
      lastSeen: now,
      contentHash: hash,
      lastTrelloMove: meta?.lastTrelloMove ?? null,
    });
    const desc = updateDescriptionWithSync(base, syncBlock);

    if (options.verbose) {
      console.log(`Moving closed item to Done: ${item.url}`);
    }
    await updateCard({ cardId: card.id, listId: doneList.id, desc, pos: "top" });
    const fromList = context.lists.find((list) => list.id === card.idList) ?? null;
    const fromListName = fromList ? listAliases[fromList.name] ?? fromList.name : null;
    const toListName = listAliases[doneList.name] ?? doneList.name;
    const labels = card.idLabels
      .map((id) => labelById.get(id))
      .filter((name): name is string => Boolean(name));
    await recordCardMove({
      cardId: card.id,
      url: meta?.url ?? item.url ?? card.shortUrl ?? card.url ?? null,
      fromList: fromListName,
      toList: toListName,
      labels,
      now,
    });
    await writeEvent({
      ts: now,
      type: "trello.card.done.closed",
      payload: { cardId: card.id, url: item.url },
    });
  }
};
