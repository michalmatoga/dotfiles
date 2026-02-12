import { createBoard, fetchBoardByShortLink } from "../lib/trello/boards";
import { loadBoardContext } from "../lib/trello/context";

export const setupBoardUseCase = async (options: {
  boardName: string;
  existingBoardShortLink: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  if (options.verbose) {
    console.log(`Fetching workspace from board ${options.existingBoardShortLink}`);
  }
  const existing = await fetchBoardByShortLink(options.existingBoardShortLink);
  const organizationId = existing.idOrganization ?? undefined;

  if (options.verbose) {
    console.log(`Creating board ${options.boardName}`);
  }

  if (options.dryRun) {
    return;
  }

  const board = await createBoard({
    name: options.boardName,
    idOrganization: organizationId,
    permissionLevel: "org",
  });

  await loadBoardContext({ boardId: board.id, allowCreate: true });

  console.log(`New board created: ${board.name} (${board.id})`);
  if (board.url) {
    console.log(`Board URL: ${board.url}`);
  }
  console.log(`Set TRELLO_BOARD_ID_WO=${board.id}`);
};
