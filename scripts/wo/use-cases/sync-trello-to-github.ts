import { requireEnv } from "../lib/env";
import { syncOutbound } from "../lib/sync/outbound";

const ghHost = "schibsted.ghe.com";
const projectOwner = "svp";
const projectNumber = 5;

export const syncTrelloToGithubUseCase = async (options: {
  verbose: boolean;
}) => {
  const boardId = requireEnv("TRELLO_BOARD_ID_WO");
  await syncOutbound({
    boardId,
    host: ghHost,
    owner: projectOwner,
    projectNumber,
    verbose: options.verbose,
  });
};
