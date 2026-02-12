import { requireEnv } from "../lib/env";
import { isIssueOpen } from "../lib/gh/issue-state";
import { fetchAssignedProjectItems } from "../lib/gh/project";
import { normalizeProjectItem, type WorkItem } from "../lib/normalize";
import { moveClosedItemsToDone } from "../lib/sync/closed-items";
import { syncInbound } from "../lib/sync/inbound";

const ghHost = "schibsted.ghe.com";
const ghUser = "michal-matoga";
const projectOwner = "svp";
const projectNumber = 5;

export const syncWorkItemsUseCase = async (options: {
  dryRun: boolean;
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  const items = await fetchAssignedProjectItems({
    host: ghHost,
    owner: projectOwner,
    number: projectNumber,
    assignee: ghUser,
  });
  const normalized = items
    .map(normalizeProjectItem)
    .filter((item): item is WorkItem => Boolean(item));

  const openItems: WorkItem[] = [];
  const closedItems: WorkItem[] = [];
  for (const item of normalized) {
    const open = await isIssueOpen({ host: ghHost, url: item.url });
    if (open) {
      openItems.push(item);
    } else {
      closedItems.push(item);
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
};
