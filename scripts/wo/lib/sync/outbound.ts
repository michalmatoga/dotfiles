import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listAliases, listToGhStatusName } from "../policy/mapping";
import { parseSyncMetadata, formatSyncMetadata, updateDescriptionWithSync } from "./metadata";
import { fetchProjectConfig, updateProjectItemStatus } from "../gh/project";
import { readLatestSnapshot, writeSnapshot } from "../state/snapshots";
import { writeEvent } from "../state/events";

export const syncOutbound = async (options: {
  boardId: string;
  host: string;
  owner: string;
  projectNumber: number;
  dryRun: boolean;
  verbose: boolean;
}) => {
  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false });
  const cards = await fetchBoardCards(options.boardId);
  const snapshot = await readLatestSnapshot();
  const previous = snapshot?.trello ?? {};
  const now = new Date().toISOString();

  const schibstedLabelId = context.labelByName.get(labelNames.schibsted)?.id;
  if (!schibstedLabelId) {
    throw new Error("Missing schibsted label in Trello board");
  }

  const projectConfig = await fetchProjectConfig({
    host: options.host,
    owner: options.owner,
    number: options.projectNumber,
  });

  for (const card of cards) {
    if (!card.idLabels.includes(schibstedLabelId)) {
      continue;
    }
    const meta = parseSyncMetadata(card.desc);
    if (!meta?.itemId) {
      continue;
    }

    const prev = previous[card.id];
    if (prev?.listId === card.idList) {
      continue;
    }

    const list = context.lists.find((item) => item.id === card.idList);
    if (!list) {
      continue;
    }
    const listName = listAliases[list.name] ?? list.name;
    const isReview = card.idLabels.includes(context.labelByName.get(labelNames.review)?.id ?? "");
    const statusName = listToGhStatusName({ listName, isReview });
    const statusOptionId = projectConfig.statusOptions[statusName];
    if (!statusOptionId) {
      throw new Error(`Missing status option for ${statusName}`);
    }

    process.env.GH_HOST = options.host;
    await updateProjectItemStatus({
      host: options.host,
      projectId: projectConfig.projectId,
      itemId: meta.itemId,
      statusFieldId: projectConfig.statusFieldId,
      statusOptionId,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    const updatedMeta = formatSyncMetadata({
      ...meta,
      lastTrelloMove: now,
    });
    const updatedDesc = updateDescriptionWithSync(card.desc, updatedMeta);
    if (!options.dryRun) {
      await updateCard({ cardId: card.id, desc: updatedDesc });
    }

    await writeEvent({
      ts: now,
      type: "github.project.status.updated",
      payload: { itemId: meta.itemId, status: statusName, cardId: card.id },
    });
  }

  const nextSnapshot = {
    ts: now,
    trello: Object.fromEntries(
      cards.map((card) => [
        card.id,
        {
          listId: card.idList,
          labels: card.idLabels,
          syncUrl: parseSyncMetadata(card.desc)?.url ?? null,
        },
      ]),
    ),
  };
  await writeSnapshot(nextSnapshot);
};
