import type { ProjectItem } from "./gh/project";
import type { ReviewRequest } from "./gh/reviews";

export type WorkItemStatus =
  | "design"
  | "ready"
  | "next"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done";

export type WorkItem = {
  id: string;
  source: "ghe-project" | "ghe-review";
  type: "issue" | "review" | "task" | "pr";
  title: string;
  url: string;
  repo: string | null;
  status: WorkItemStatus;
  body: string | null;
  projectItemId?: string;
};

export const normalizeProjectItem = (item: ProjectItem): WorkItem | null => {
  const url = item.content?.url;
  const title = item.content?.title ?? item.title;
  if (!url || !title) {
    return null;
  }

  const status = normalizeStatus(item.status ?? null);
  const type = item.content?.type === "PullRequest" ? "pr" : "issue";
  return {
    id: item.id,
    source: "ghe-project",
    type,
    title,
    url,
    repo: item.content?.repository ?? null,
    status,
    body: item.content?.body ?? null,
    projectItemId: item.id,
  };
};

export const normalizeReviewRequest = (item: ReviewRequest): WorkItem => ({
  id: item.url,
  source: "ghe-review",
  type: "review",
  title: item.title,
  url: item.url,
  repo: item.repo ?? null,
  status: "ready",
  body: item.body ?? null,
});

const normalizeStatus = (status: string | null): WorkItemStatus => {
  switch (status) {
    case "🔍 Design, Research and Investigation":
      return "design";
    case "📋 Ready":
      return "ready";
    case "🔖 Next up":
      return "next";
    case "🏗 In progress":
      return "in_progress";
    case "👀 In review":
      return "in_review";
    case "🚫 Blocked":
      return "blocked";
    case "✅ Done":
      return "done";
    default:
      return "design";
  }
};
