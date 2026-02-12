import { ghJson } from "./gh";
import { runCommand } from "../command";

export type ProjectItemContent = {
  title: string;
  url: string;
  body?: string | null;
  number?: number | null;
  repository?: string | null;
  type?: string | null;
};

export type ProjectItem = {
  id: string;
  title: string;
  status?: string | null;
  assignees?: string[];
  content?: ProjectItemContent | null;
};

type ProjectItemListResponse = {
  items: ProjectItem[];
};

export type ProjectStatusOption = {
  id: string;
  name: string;
};

type ProjectField = {
  id: string;
  name: string;
  type: string;
  options?: ProjectStatusOption[];
};

type ProjectFieldListResponse = {
  fields: ProjectField[];
};

export type ProjectConfig = {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
};

export const updateProjectItemStatus = async (options: {
  host: string;
  projectId: string;
  itemId: string;
  statusFieldId: string;
  statusOptionId: string;
  dryRun: boolean;
  verbose: boolean;
}) => {
  await runCommand(
    "gh",
    [
      "project",
      "item-edit",
      "--id",
      options.itemId,
      "--project-id",
      options.projectId,
      "--field-id",
      options.statusFieldId,
      "--single-select-option-id",
      options.statusOptionId,
    ],
    { dryRun: options.dryRun, verbose: options.verbose },
  );
};

export const fetchAssignedProjectItems = async (options: {
  host: string;
  owner: string;
  number: number;
  assignee: string;
}): Promise<ProjectItem[]> => {
  const response = await ghJson<ProjectItemListResponse>(
    [
      "project",
      "item-list",
      String(options.number),
      "--owner",
      options.owner,
      "--limit",
      "2000",
      "--format",
      "json",
    ],
    { host: options.host },
  );

  return response.items.filter((item) =>
    (item.assignees ?? []).some((assignee) => assignee === options.assignee),
  );
};

export const fetchProjectConfig = async (options: {
  host: string;
  owner: string;
  number: number;
}): Promise<ProjectConfig> => {
  const project = await ghJson<{ id: string }>(
    ["project", "view", String(options.number), "--owner", options.owner, "--format", "json"],
    { host: options.host },
  );

  const fields = await ghJson<ProjectFieldListResponse>(
    ["project", "field-list", String(options.number), "--owner", options.owner, "--format", "json"],
    { host: options.host },
  );

  const statusField = fields.fields.find((field) => field.name === "Status");
  if (!statusField || !statusField.options) {
    throw new Error("Project Status field not found");
  }

  const statusOptions: Record<string, string> = {};
  for (const option of statusField.options) {
    statusOptions[option.name] = option.id;
  }

  return {
    projectId: project.id,
    statusFieldId: statusField.id,
    statusOptions,
  };
};
