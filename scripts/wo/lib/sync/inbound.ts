import { createHash } from "node:crypto";

import { updateCard, createCard, fetchBoardCards, type TrelloCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listNames, workStatusToList } from "../policy/mapping";
import {
  extractDescriptionBase,
  formatSyncMetadata,
  parseSyncMetadata,
  updateDescriptionWithSync,
} from "./metadata";
import type { WorkItem } from "../normalize";
import { writeEvent } from "../state/events";

const extractUrlFromDesc = (desc: string): string | null => {
  const match = desc.match(/https:\/\/\S+/);
  return match?.[0] ?? null;
};

const extractNumberFromUrl = (url: string): number | null => {
  const match = url.match(/\/(issues|pull)\/(\d+)/);
  return match ? Number(match[2]) : null;
};

const buildCardTitle = (item: WorkItem): string => {
  const repo = item.repo ?? "unknown";
  if (item.type === "review") {
    return `REVIEW: ${repo} ${item.title}`;
  }
  const number = extractNumberFromUrl(item.url);
  return number ? `WORK: ${repo} #${number} ${item.title}` : `WORK: ${repo} ${item.title}`;
};

const normalizeBase = (value: string): string => value.replace(/\r\n/g, "\n").trim();

const buildBaseDescription = (item: WorkItem): string =>
  normalizeBase(item.body ? `${item.url}\n\n${item.body}` : item.url);

const contentHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const ensureLabelIds = (labelIds: string[], currentLabels: string[]) => {
  const set = new Set(currentLabels);
  for (const id of labelIds) {
    set.add(id);
  }
  return [...set];
};

const cardNeedsUpdate = (options: {
  card: TrelloCard;
  name: string;
  desc: string;
  listId?: string;
  labelIds: string[];
}): boolean => {
  if (options.card.name !== options.name) {
    return true;
  }
  if (options.listId && options.card.idList !== options.listId) {
    return true;
  }
  const labelsSorted = [...options.card.idLabels].sort().join(",");
  const desiredSorted = [...options.labelIds].sort().join(",");
  if (labelsSorted !== desiredSorted) {
    return true;
  }
  if (options.card.desc !== options.desc) {
    return true;
  }
  return false;
};

export const syncInbound = async (options: {
  boardId: string;
  items: WorkItem[];
  verbose: boolean;
}) => {
  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false });
  const cards = await fetchBoardCards(options.boardId);
  const cardByUrl = new Map<string, TrelloCard>();
  const cardByItemId = new Map<string, TrelloCard>();

  for (const card of cards) {
    const meta = parseSyncMetadata(card.desc);
    if (meta?.url) {
      cardByUrl.set(meta.url, card);
    }
    if (meta?.itemId) {
      cardByItemId.set(meta.itemId, card);
    }
    const fallbackUrl = extractUrlFromDesc(card.desc);
    if (fallbackUrl && !cardByUrl.has(fallbackUrl)) {
      cardByUrl.set(fallbackUrl, card);
    }
  }

  for (const item of options.items) {
    const now = new Date().toISOString();
    const baseList = item.type === "review" ? listNames.ready : workStatusToList(item.status);
    const card = item.projectItemId
      ? cardByItemId.get(item.projectItemId) ?? cardByUrl.get(item.url)
      : cardByUrl.get(item.url);
    const targetList = baseList;
    const list = context.listByName.get(targetList);
    if (!list) {
      throw new Error(`Missing Trello list mapping for ${targetList}`);
    }

    const labelIds = [context.labelByName.get(labelNames.schibsted)?.id].filter(
      Boolean,
    ) as string[];
    if (item.type === "review") {
      const reviewLabel = context.labelByName.get(labelNames.review);
      if (reviewLabel) {
        labelIds.push(reviewLabel.id);
      }
    }

    const name = buildCardTitle(item);
    const desiredBase = buildBaseDescription(item);
    const desiredHash = contentHash(desiredBase);
    const currentBase = card ? normalizeBase(extractDescriptionBase(card.desc)) : "";
    const currentHash = currentBase ? contentHash(currentBase) : null;
    const currentMeta = card ? parseSyncMetadata(card.desc) : null;

    let baseToUse = desiredBase;
    let baseHashToUse = desiredHash;
    if (card && currentMeta?.contentHash && currentHash && currentHash !== currentMeta.contentHash) {
      baseToUse = currentBase;
      baseHashToUse = currentHash;
    } else if (card && currentMeta?.contentHash && currentMeta.contentHash === currentHash) {
      baseToUse = desiredBase;
      baseHashToUse = desiredHash;
    }

    const mergedLabelIds = card ? ensureLabelIds(labelIds, card.idLabels) : labelIds;
    const desiredLabels = mergedLabelIds;
    const shouldUpdate =
      !card ||
      card.name !== name ||
      [...card.idLabels].sort().join(",") !== [...desiredLabels].sort().join(",") ||
      (currentMeta?.status ?? null) !== item.status ||
      (currentMeta?.url ?? null) !== item.url ||
      (currentMeta?.itemId ?? null) !== (item.projectItemId ?? null) ||
      (currentMeta?.contentHash ?? null) !== baseHashToUse;

    if (!card) {
      if (options.verbose) {
        console.log(`Creating Trello card for ${item.url}`);
      }
      const syncBlock = formatSyncMetadata({
        source: item.source,
        itemId: item.projectItemId ?? null,
        url: item.url,
        status: item.status,
        lastSeen: now,
        contentHash: baseHashToUse,
      });
      const desc = updateDescriptionWithSync(baseToUse, syncBlock);
      await createCard({ listId: list.id, name, desc, labelIds: desiredLabels });
      await writeEvent({
        ts: now,
        type: "trello.card.created",
        payload: { url: item.url, list: list.name },
      });
      continue;
    }

    if (!shouldUpdate) {
      continue;
    }

    const syncBlock = formatSyncMetadata({
      source: item.source,
      itemId: item.projectItemId ?? null,
      url: item.url,
      status: item.status,
      lastSeen: now,
      contentHash: baseHashToUse,
    });
    const desc = updateDescriptionWithSync(baseToUse, syncBlock);
    if (cardNeedsUpdate({ card, name, desc, labelIds: desiredLabels })) {
      if (options.verbose) {
        console.log(`Updating Trello card ${card.id} for ${item.url}`);
      }
      await updateCard({
        cardId: card.id,
        name,
        desc,
        labelIds: desiredLabels,
      });
      await writeEvent({
        ts: now,
        type: "trello.card.updated",
        payload: { cardId: card.id, url: item.url, list: list.name },
      });
    }
  }
};
