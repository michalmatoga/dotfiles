import { getLabelsFromFirstCardInDoingList } from "./hg/lib/trello";

(async function main() {
  const labels = (await getLabelsFromFirstCardInDoingList())
    .map((l: { name: string }) => `trello-label: ${l.name}`)
    .join("\n");
  console.log(labels);
})();
