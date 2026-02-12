import { requireEnv } from "../lib/env";
import { fetchAssignedProjectItemsGraphql } from "../lib/gh/project";
import { normalizeProjectItem, type WorkItem } from "../lib/normalize";
import { readLatestSnapshot, writeSnapshot } from "../lib/state/snapshots";
import { moveClosedItemsToDone } from "../lib/sync/closed-items";
import { syncInbound } from "../lib/sync/inbound";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";
const projectOwner = "svp";
const projectNumber = 5;

export const syncWorkItemsUseCase = async (options: {
  dryRun: boolean;
  verbose: boolean;
  fullRefresh: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const snapshot = await readLatestSnapshot();
  const previousProject = options.fullRefresh ? {} : snapshot?.project ?? {};
  const now = new Date();
  const lastFull = previousProject.fullRefreshAt
    ? new Date(previousProject.fullRefreshAt)
    : null;
  const autoFullRefresh = !lastFull || now.getTime() - lastFull.getTime() > 24 * 60 * 60 * 1000;
  const fullRefresh = options.fullRefresh || autoFullRefresh;
  const lastSyncAt = fullRefresh ? null : previousProject.lastSyncAt ?? null;

  const { items, maxUpdatedAt } = await fetchAssignedProjectItemsGraphql({
    host: ghHost,
    owner: projectOwner,
    number: projectNumber,
    assignee: ghUser,
    lastSyncAt,
    fullRefresh,
  });
  const normalized = items
    .map(normalizeProjectItem)
    .filter((item): item is WorkItem => Boolean(item));
  const itemStateById = new Map(
    items.map((item) => [item.id, item.content?.state ?? null]),
  );

  const openItems: WorkItem[] = [];
  const closedItems: WorkItem[] = [];
  for (const item of normalized) {
    const contentState = itemStateById.get(item.id) ?? null;
    const isClosed = contentState && contentState !== "OPEN";
    if (isClosed) {
      closedItems.push(item);
    } else {
      openItems.push(item);
    }
  }

  await moveClosedItemsToDone({
    boardId,
    items: closedItems,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });
  await syncInbound({
    boardId,
    items: openItems,
    dryRun: options.dryRun,
    verbose: options.verbose,
  });

  const nextProject = {
    ...previousProject,
    lastSyncAt: maxUpdatedAt ?? now.toISOString(),
    fullRefreshAt: fullRefresh ? now.toISOString() : previousProject.fullRefreshAt ?? null,
    items: {
      ...(fullRefresh ? {} : previousProject.items ?? {}),
      ...Object.fromEntries(
        items
          .filter((item) => item.updatedAt)
          .map((item) => [item.id, { updatedAt: item.updatedAt! }]),
      ),
    },
  };

  await writeSnapshot({
    ts: now.toISOString(),
    trello: snapshot?.trello,
    project: nextProject,
  });
};
