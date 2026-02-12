import { createHash } from "node:crypto";

import { fetchPrDetails, resolveLatestReviewState, type PrDetails } from "../gh/pr-details";
import { fetchBoardCards, updateCard } from "../trello/cards";
import { loadBoardContext } from "../trello/context";
import { labelNames, listNames } from "../policy/mapping";
import {
  extractDescriptionBase,
  formatSyncMetadata,
  parseSyncMetadata,
  updateDescriptionWithSync,
} from "./metadata";
import { writeEvent } from "../state/events";

const contentHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const closingKeywordRegex = /(fixes|closes|resolves)\s+#(\d+)/gi;
const closingUrlRegex =
  /(fixes|closes|resolves)\s+https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/issues\/(\d+)/gi;

const parseRepoFromPrUrl = (host: string, url: string): { owner: string; repo: string } | null => {
  const escapedHost = host.replace(/\./g, "\\.");
  const match = url.match(new RegExp(`https://${escapedHost}/([^/]+)/([^/]+)/pull/\\d+`));
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
};

const parseClosingIssueUrls = (options: {
  host: string;
  body: string | null;
  prUrl: string;
}): string[] => {
  if (!options.body) {
    return [];
  }
  const repo = parseRepoFromPrUrl(options.host, options.prUrl);
  const matches: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = closingKeywordRegex.exec(options.body))) {
    const [, , number] = match;
    if (repo) {
      matches.push(`https://${options.host}/${repo.owner}/${repo.repo}/issues/${number}`);
    }
  }
  while ((match = closingUrlRegex.exec(options.body))) {
    const [, , host, owner, repo, number] = match;
    if (host !== options.host) {
      continue;
    }
    matches.push(`https://${host}/${owner}/${repo}/issues/${number}`);
  }
  return matches;
};

const ensureRelatedPrSection = (base: string, prUrl: string): string => {
  if (base.includes(prUrl)) {
    return base;
  }
  const sectionHeader = "Related PRs:";
  if (base.includes(sectionHeader)) {
    return `${base}\n- ${prUrl}`;
  }
  return `${base}\n\n${sectionHeader}\n- ${prUrl}`.trim();
};

const selectNewestPr = (prs: PrDetails[]): PrDetails => {
  return [...prs].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  })[0];
};

const hasReviewState = (details: PrDetails, state: string) =>
  details.reviews.some((review) => review.state === state);

const desiredListForPr = (options: {
  pr: PrDetails;
  currentUser: string;
}): string | null => {
  if (options.pr.merged) {
    return listNames.done;
  }
  if (options.pr.author !== options.currentUser) {
    return null;
  }
  if (hasReviewState(options.pr, "CHANGES_REQUESTED")) {
    return listNames.ready;
  }
  if (hasReviewState(options.pr, "APPROVED")) {
    return listNames.ready;
  }
  if (options.pr.reviewRequests.length > 0) {
    return listNames.waiting;
  }
  const latest = resolveLatestReviewState(options.pr);
  if (latest === "APPROVED" && options.pr.mergeable === "MERGEABLE") {
    return listNames.ready;
  }
  return null;
};

export const syncLinkedPrs = async (options: {
  boardId: string;
  host: string;
  currentUser: string;
  prUrls: string[];
  dryRun: boolean;
  verbose: boolean;
}): Promise<Set<string>> => {
  if (options.prUrls.length === 0) {
    return new Set();
  }

  const context = await loadBoardContext({ boardId: options.boardId, allowCreate: false });
  const cards = await fetchBoardCards(options.boardId);
  const cardByUrl = new Map<string, (typeof cards)[number]>();
  for (const card of cards) {
    const meta = parseSyncMetadata(card.desc);
    if (meta?.url) {
      cardByUrl.set(meta.url, card);
    }
  }

  const handled = new Set<string>();
  const issueToPrs = new Map<
    string,
    { card: (typeof cards)[number]; prs: PrDetails[] }
  >();

  for (const prUrl of options.prUrls) {
    const details = await fetchPrDetails({ host: options.host, url: prUrl });
    const issueUrls = parseClosingIssueUrls({
      host: options.host,
      body: details.body,
      prUrl: details.url,
    });
    const issueUrl = issueUrls.find((url) => cardByUrl.has(url));
    if (!issueUrl) {
      continue;
    }
    const card = cardByUrl.get(issueUrl);
    if (!card) {
      continue;
    }
    handled.add(prUrl);
    const entry = issueToPrs.get(issueUrl) ?? { card, prs: [] };
    entry.prs.push(details);
    issueToPrs.set(issueUrl, entry);

    const base = extractDescriptionBase(card.desc);
    const updatedBase = ensureRelatedPrSection(base, details.url);
    if (updatedBase !== base) {
      const meta = parseSyncMetadata(card.desc);
      const syncBlock = formatSyncMetadata({
        source: meta?.source ?? "ghe-project",
        itemId: meta?.itemId ?? null,
        url: meta?.url ?? issueUrl,
        status: meta?.status ?? null,
        lastSeen: new Date().toISOString(),
        contentHash: contentHash(updatedBase),
        lastTrelloMove: meta?.lastTrelloMove ?? null,
      });
      const desc = updateDescriptionWithSync(updatedBase, syncBlock);
      if (!options.dryRun) {
        await updateCard({ cardId: card.id, desc });
      }
    }
  }

  for (const { card, prs } of issueToPrs.values()) {
    const newest = selectNewestPr(prs);
    const desiredList = desiredListForPr({ pr: newest, currentUser: options.currentUser });
    if (!desiredList) {
      continue;
    }
    const waitingList = context.listByName.get(listNames.waiting);
    if (!waitingList || card.idList !== waitingList.id) {
      continue;
    }
    const list = context.listByName.get(desiredList);
    if (!list || list.id === card.idList) {
      continue;
    }
    const reviewLabelId =
      desiredList === listNames.waiting
        ? context.labelByName.get(labelNames.review)?.id
        : undefined;
    const meta = parseSyncMetadata(card.desc);
    const base = extractDescriptionBase(card.desc);
    const syncBlock = formatSyncMetadata({
      source: meta?.source ?? "ghe-project",
      itemId: meta?.itemId ?? null,
      url: meta?.url ?? "",
      status: meta?.status ?? null,
      lastSeen: new Date().toISOString(),
      contentHash: contentHash(base),
      lastTrelloMove: meta?.lastTrelloMove ?? null,
    });
    const desc = updateDescriptionWithSync(base, syncBlock);
    if (options.verbose) {
      console.log(`Moving linked issue card ${card.id} to ${desiredList}`);
    }
    if (!options.dryRun) {
      await updateCard({
        cardId: card.id,
        listId: list.id,
        desc,
        pos: desiredList === listNames.ready ? "top" : undefined,
        labelIds: reviewLabelId
          ? Array.from(new Set([...card.idLabels, reviewLabelId]))
          : undefined,
      });
    }
    await writeEvent({
      ts: new Date().toISOString(),
      type: "trello.card.moved.linked-pr",
      payload: { cardId: card.id, list: desiredList, pr: newest.url },
    });
  }

  return handled;
};
