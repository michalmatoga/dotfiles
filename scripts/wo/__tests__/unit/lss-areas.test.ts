import {
  indexLssAreas,
  loadLssAreas,
  resolveLssArea,
} from "../../lib/trello/lss-areas";

describe("LSS area resolution", () => {
  it("loads the configured human-readable LSS areas", async () => {
    const areas = await loadLssAreas();

    expect(areas.map((area) => area.label)).toEqual([
      "business",
      "career",
      "health",
      "growth",
      "household",
      "relationships",
    ]);
  });

  it("resolves a single matching label", async () => {
    const areaByLabel = indexLssAreas(await loadLssAreas());

    expect(resolveLssArea({ labelNames: ["dotfiles", "business"], areaByLabel })).toEqual({
      status: "single",
      area: {
        label: "business",
        title: "Business",
        noteId: "ot-business",
      },
    });
  });

  it("returns none when no LSS area label is present", async () => {
    const areaByLabel = indexLssAreas(await loadLssAreas());

    expect(resolveLssArea({ labelNames: ["dotfiles", "review"], areaByLabel })).toEqual({
      status: "none",
    });
  });

  it("returns multiple when more than one LSS area label is present", async () => {
    const areaByLabel = indexLssAreas(await loadLssAreas());

    expect(resolveLssArea({ labelNames: ["business", "growth", "dotfiles"], areaByLabel })).toEqual({
      status: "multiple",
      labels: ["business", "growth"],
    });
  });
});
