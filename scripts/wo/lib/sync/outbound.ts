import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listAliases, listToGhStatusName } from "../policy/mapping";
import { parseSyncMetadata, formatSyncMetadata, updateDescriptionWithSync } from "./metadata";
import { fetchProjectConfig, updateProjectItemStatus } from "../gh/project";
import {
  readLatestSnapshot,
  writeSnapshot,
  type ProjectMetaSnapshot,
} from "../state/snapshots";
import { writeEvent } from "../state/events";
import { recordCardMove } from "../metrics/lifecycle";
import { loadLabelRepoMap } from "../trello/label-mapping";

export const syncOutbound = async (options: {
  boardId: string;
  host: string;
  owner: string;
  projectNumber: number;
  verbose: boolean;
}) => {
  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false, allowCreateLabels: true });
  const cards = await fetchBoardCards(options.boardId);
  const snapshot = await readLatestSnapshot();
  const previous = snapshot?.trello ?? {};
  const now = new Date().toISOString();
  const labelRepoMap = await loadLabelRepoMap();

  // Build reverse map from label ID to name
  const labelById = new Map<string, string>();
  for (const label of context.labels) {
    if (label.name) {
      labelById.set(label.id, label.name);
    }
  }

  const schibstedLabelId = context.labelByName.get(labelNames.schibsted)?.id ?? null;

  const meta = snapshot?.project?.meta ?? null;
  const metaIsFresh = meta
    ? Date.now() - new Date(meta.fetchedAt).getTime() < 24 * 60 * 60 * 1000
    : false;
  const projectConfig = metaIsFresh
    ? {
        projectId: meta!.projectId,
        statusFieldId: meta!.statusFieldId,
        statusOptions: meta!.statusOptions,
      }
    : await fetchProjectConfig({
        host: options.host,
        owner: options.owner,
        number: options.projectNumber,
      });
  const projectMeta: ProjectMetaSnapshot = metaIsFresh
    ? meta!
    : {
        projectId: projectConfig.projectId,
        statusFieldId: projectConfig.statusFieldId,
        statusOptions: projectConfig.statusOptions,
        fetchedAt: now,
      };

  for (const card of cards) {
    const labelNamesList = card.idLabels
      .map((id) => labelById.get(id))
      .filter((name): name is string => Boolean(name));
    const hasMappedLabel = labelNamesList.some((name) => labelRepoMap.has(name));
    const hasHouseholdLabel = labelNamesList.includes(labelNames.household);
    const hasSchibstedLabel = schibstedLabelId ? card.idLabels.includes(schibstedLabelId) : false;
    if (!hasSchibstedLabel && !hasMappedLabel && !hasHouseholdLabel) {
      continue;
    }
    const meta = parseSyncMetadata(card.desc);
    const prev = previous[card.id];
    const listChanged = prev?.listId !== card.idList;

    const list = context.lists.find((item) => item.id === card.idList);
    if (!list) {
      continue;
    }
    const listName = listAliases[list.name] ?? list.name;
    const prevList = prev?.listId
      ? context.lists.find((item) => item.id === prev.listId)
      : null;
    const prevListName = prevList ? listAliases[prevList.name] ?? prevList.name : null;

    const cardUrl = meta?.url ?? card.shortUrl ?? card.url ?? null;

    // Emit trello.card.moved for cards that changed lists and are relevant for worktrees
    if (listChanged && cardUrl && (meta?.url || hasMappedLabel || hasHouseholdLabel)) {
      await writeEvent({
        ts: now,
        type: "trello.card.moved",
        payload: {
          cardId: card.id,
          url: cardUrl,
          itemId: meta?.itemId ?? null,
          fromList: prevListName,
          toList: listName,
          labels: card.idLabels,
          name: card.name,
        },
      });

      // Record metrics for card lifecycle tracking
      await recordCardMove({
        cardId: card.id,
        url: cardUrl,
        fromList: prevListName,
        toList: listName,
        labels: labelNamesList,
        now,
      });
    }

    // Skip GH Project update for cards without schibsted label/itemId
    if (!hasSchibstedLabel || !meta?.itemId || !listChanged) {
      continue;
    }

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
      verbose: options.verbose,
    });

    const updatedMeta = formatSyncMetadata({
      ...meta,
      lastTrelloMove: now,
    });
    const updatedDesc = updateDescriptionWithSync(card.desc, updatedMeta);
    await updateCard({ cardId: card.id, desc: updatedDesc });

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
    project: {
      ...(snapshot?.project ?? {}),
      meta: projectMeta,
    },
    worktrees: snapshot?.worktrees ?? null,
  };
  await writeSnapshot(nextSnapshot);
};
