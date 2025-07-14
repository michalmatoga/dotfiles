import { getLabelsFromFirstCardInDoingList } from "./hg/lib/trello";

(async function main() {
  // TODO: add time guard to only add notes when in time block
  const labels = (await getLabelsFromFirstCardInDoingList())
    .map((l: { name: string }) => `trello-label: ${encodeURI(l.name)}`)
    .join("\n");
  console.log(labels);
})();
