export const listNames = {
  triage: "Triage",
  ready: "Ready",
  doing: "Doing",
  waiting: "Waiting",
  done: "Done",
};

export const listAliases: Record<string, string> = {
  "Done (This Week)": "Done",
  "✅ Done": "Done",
};

export const labelNames = {
  schibsted: "schibsted",
  review: "review",
  business: "business",
  career: "career",
  health: "health",
  growth: "growth",
  household: "household",
  relationships: "relationships",
  elikonas: "elikonas",
  journal: "journal",
  dotfiles: "dotfiles",
};

export const ghStatusToList = (status: string | null | undefined): string => {
  switch (status) {
    case "🔍 Design, Research and Investigation":
      return listNames.triage;
    case "📋 Ready":
    case "🔖 Next up":
      return listNames.ready;
    case "🏗 In progress":
      return listNames.doing;
    case "👀 In review":
      return listNames.waiting;
    case "✅ Done":
      return listNames.done;
    case "🚫 Blocked":
      return listNames.waiting;
    default:
      return listNames.triage;
  }
};

export const workStatusToList = (status: string | null | undefined): string => {
  switch (status) {
    case "design":
      return listNames.triage;
    case "ready":
    case "next":
      return listNames.ready;
    case "in_progress":
      return listNames.doing;
    case "in_review":
      return listNames.waiting;
    case "blocked":
      return listNames.waiting;
    case "done":
      return listNames.done;
    default:
      return listNames.triage;
  }
};

export const listToGhStatusName = (options: {
  listName: string;
  isReview: boolean;
}): string => {
  const normalized = listAliases[options.listName] ?? options.listName;
  switch (normalized) {
    case listNames.ready:
      return "📋 Ready";
    case listNames.doing:
      return "🏗 In progress";
    case listNames.waiting:
      return options.isReview ? "👀 In review" : "🚫 Blocked";
    case listNames.done:
      return "✅ Done";
    default:
      return "📋 Ready";
  }
};
