import { ghGraphql, ghJson } from "./gh";
import { runCommand } from "../command";

export type ProjectItemContent = {
  title: string;
  url: string;
  body?: string | null;
  number?: number | null;
  repository?: string | null;
  type?: string | null;
  state?: string | null;
};

export type ProjectItem = {
  id: string;
  title: string;
  status?: string | null;
  assignees?: string[];
  content?: ProjectItemContent | null;
  updatedAt?: string | null;
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

type ProjectItemNode = {
  id: string;
  updatedAt: string;
  fieldValues: {
    nodes: Array<{
      field?: { name?: string | null } | null;
      name?: string | null;
    }>;
  };
  content: {
    __typename: string;
    title: string;
    url: string;
    body?: string | null;
    state?: string | null;
    repository?: { nameWithOwner?: string | null } | null;
    assignees?: { nodes: Array<{ login: string }> } | null;
  } | null;
};

type ProjectItemsResponse = {
  data: {
    organization: {
      projectV2: {
        id: string;
        items: {
          nodes: ProjectItemNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    } | null;
  };
};

const projectItemsQuery = `
query($owner: String!, $number: Int!, $after: String) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      items(first: 100, after: $after) {
        nodes {
          id
          updatedAt
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                field {
                  ... on ProjectV2SingleSelectField { name }
                }
                name
              }
            }
          }
          content {
            __typename
            ... on Issue { title url body state repository { nameWithOwner } assignees(first: 20) { nodes { login } } }
            ... on PullRequest { title url body state repository { nameWithOwner } assignees(first: 20) { nodes { login } } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
`;

export const fetchAssignedProjectItemsGraphql = async (options: {
  host: string;
  owner: string;
  number: number;
  assignee: string;
  lastSyncAt?: string | null;
  fullRefresh: boolean;
}): Promise<{ items: ProjectItem[]; maxUpdatedAt: string | null }> => {
  let cursor: string | null = null;
  let hasNextPage = true;
  const items: ProjectItem[] = [];
  let maxUpdatedAt: string | null = null;

  while (hasNextPage) {
    const response = await ghGraphql<ProjectItemsResponse>(
      projectItemsQuery,
      {
        owner: options.owner,
        number: options.number,
        after: cursor ?? undefined,
      },
      { host: options.host },
    );

    const project = response.data.organization?.projectV2;
    if (!project) {
      throw new Error("Failed to load project items from GraphQL response");
    }

    const nodes = project.items.nodes;
    if (nodes.length === 0) {
      break;
    }

    let pageIsStale = Boolean(options.lastSyncAt) && !options.fullRefresh;
    for (const node of nodes) {
      if (!maxUpdatedAt || node.updatedAt > maxUpdatedAt) {
        maxUpdatedAt = node.updatedAt;
      }
      if (options.lastSyncAt && node.updatedAt > options.lastSyncAt) {
        pageIsStale = false;
      }
      const assignees = node.content?.assignees?.nodes.map((assignee) => assignee.login) ?? [];
      if (!assignees.includes(options.assignee)) {
        continue;
      }
      if (!options.fullRefresh && options.lastSyncAt && node.updatedAt <= options.lastSyncAt) {
        continue;
      }

      const statusNode = node.fieldValues.nodes.find(
        (value) => value.field?.name === "Status",
      );
      items.push({
        id: node.id,
        title: node.content?.title ?? "",
        status: statusNode?.name ?? null,
        assignees,
        content: node.content
          ? {
              title: node.content.title,
              url: node.content.url,
              body: node.content.body ?? null,
              repository: node.content.repository?.nameWithOwner ?? null,
              state: node.content.state ?? null,
              type: node.content.__typename,
            }
          : null,
        updatedAt: node.updatedAt,
      });
    }

    if (pageIsStale) {
      break;
    }

    hasNextPage = project.items.pageInfo.hasNextPage;
    cursor = project.items.pageInfo.endCursor;
  }

  return { items, maxUpdatedAt };
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
