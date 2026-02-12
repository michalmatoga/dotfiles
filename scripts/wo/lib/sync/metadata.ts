export type SyncMetadata = {
  source: string;
  itemId?: string | null;
  issueId?: string | null;
  prId?: string | null;
  url?: string | null;
  status?: string | null;
  lastSeen?: string | null;
  lastTrelloMove?: string | null;
  contentHash?: string | null;
};

const blockStart = "[wf-sync]";
const blockEnd = "[/wf-sync]";

export const parseSyncMetadata = (desc: string): SyncMetadata | null => {
  const start = desc.indexOf(blockStart);
  const end = desc.indexOf(blockEnd);
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  const block = desc.slice(start + blockStart.length, end).trim();
  const data: SyncMetadata = { source: "" };
  for (const line of block.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    const value = rest.join("=").trim();
    switch (key.trim()) {
      case "source":
        data.source = value;
        break;
      case "item_id":
        data.itemId = value;
        break;
      case "issue_id":
        data.issueId = value;
        break;
      case "pr_id":
        data.prId = value;
        break;
      case "url":
        data.url = value;
        break;
      case "status":
        data.status = value;
        break;
      case "last_seen":
        data.lastSeen = value;
        break;
      case "last_trello_move":
        data.lastTrelloMove = value;
        break;
      case "content_hash":
        data.contentHash = value;
        break;
      default:
        break;
    }
  }
  return data;
};

export const formatSyncMetadata = (metadata: SyncMetadata): string => {
  const lines = [
    `source=${metadata.source}`,
    metadata.itemId ? `item_id=${metadata.itemId}` : null,
    metadata.issueId ? `issue_id=${metadata.issueId}` : null,
    metadata.prId ? `pr_id=${metadata.prId}` : null,
    metadata.url ? `url=${metadata.url}` : null,
    metadata.status ? `status=${metadata.status}` : null,
    metadata.lastSeen ? `last_seen=${metadata.lastSeen}` : null,
    metadata.lastTrelloMove ? `last_trello_move=${metadata.lastTrelloMove}` : null,
    metadata.contentHash ? `content_hash=${metadata.contentHash}` : null,
  ].filter(Boolean);

  return `${blockStart}\n${lines.join("\n")}\n${blockEnd}`;
};

export const updateDescriptionWithSync = (desc: string, syncBlock: string): string => {
  const start = desc.indexOf(blockStart);
  const end = desc.indexOf(blockEnd);
  let base = desc;
  if (start !== -1 && end !== -1 && end > start) {
    base = `${desc.slice(0, start).trim()}\n${desc.slice(end + blockEnd.length).trim()}`.trim();
  }
  if (!base) {
    return `${syncBlock}\n`;
  }
  return `${base}\n\n${syncBlock}\n`;
};

export const extractDescriptionBase = (desc: string): string => {
  const start = desc.indexOf(blockStart);
  const end = desc.indexOf(blockEnd);
  if (start !== -1 && end !== -1 && end > start) {
    return `${desc.slice(0, start).trim()}\n${desc.slice(end + blockEnd.length).trim()}`.trim();
  }
  return desc.trim();
};
