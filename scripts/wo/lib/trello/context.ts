import { createLabel, fetchBoardLabels, type TrelloLabel } from "./labels";
import { createList, fetchBoardLists, type TrelloList } from "./lists";
import { labelNames, listAliases, listNames } from "../policy/mapping";

export type BoardContext = {
  lists: TrelloList[];
  labels: TrelloLabel[];
  listByName: Map<string, TrelloList>;
  labelByName: Map<string, TrelloLabel>;
};

const canonicalListName = (name: string) => listAliases[name] ?? name;

export const loadBoardContext = async (options: {
  boardId: string;
  allowCreate?: boolean;
}): Promise<BoardContext> => {
  const lists = await fetchBoardLists(options.boardId);
  const labels = await fetchBoardLabels(options.boardId);
  const listByName = new Map<string, TrelloList>();
  const labelByName = new Map<string, TrelloLabel>();

  for (const list of lists) {
    listByName.set(canonicalListName(list.name), list);
  }
  for (const label of labels) {
    if (label.name) {
      labelByName.set(label.name, label);
    }
  }

  const requiredLists = Object.values(listNames);
  for (const name of requiredLists) {
    if (listByName.has(name)) {
      continue;
    }
    if (!options.allowCreate) {
      throw new Error(`Missing Trello list: ${name}`);
    }
    const created = await createList({ boardId: options.boardId, name });
    listByName.set(name, created);
    lists.push(created);
  }

  const requiredLabels = Object.values(labelNames);
  for (const name of requiredLabels) {
    if (labelByName.has(name)) {
      continue;
    }
    if (!options.allowCreate) {
      throw new Error(`Missing Trello label: ${name}`);
    }
    const created = await createLabel({ boardId: options.boardId, name });
    labelByName.set(name, created);
    labels.push(created);
  }

  return { lists, labels, listByName, labelByName };
};
