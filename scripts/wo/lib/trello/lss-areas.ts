import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type LssArea = {
  label: string;
  title: string;
  noteId: string;
};

export type LssAreaResolution =
  | { status: "none" }
  | { status: "multiple"; labels: string[] }
  | { status: "single"; area: LssArea };

const mappingPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../config/lss-areas.json",
);

type LssAreaConfig = Array<{
  label?: unknown;
  title?: unknown;
  noteId?: unknown;
}>;

export const UNMAPPED_LSS_AREA_KEY = "unmapped";
export const UNMAPPED_LSS_AREA_TITLE = "Unmapped";

export const loadLssAreas = async (): Promise<LssArea[]> => {
  const raw = await readFile(mappingPath, "utf8");
  const parsed = JSON.parse(raw) as LssAreaConfig;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid LSS area config: expected an array");
  }
  return parsed.map((entry) => {
    if (
      typeof entry.label !== "string"
      || typeof entry.title !== "string"
      || typeof entry.noteId !== "string"
    ) {
      throw new Error("Invalid LSS area config entry");
    }
    return {
      label: entry.label,
      title: entry.title,
      noteId: entry.noteId,
    };
  });
};

export const indexLssAreas = (areas: LssArea[]): Map<string, LssArea> =>
  new Map(areas.map((area) => [area.label, area]));

export const resolveLssArea = (options: {
  labelNames: string[];
  areaByLabel: Map<string, LssArea>;
}): LssAreaResolution => {
  const matches = options.labelNames
    .map((name) => options.areaByLabel.get(name))
    .filter((area): area is LssArea => Boolean(area));

  if (matches.length === 0) {
    return { status: "none" };
  }

  if (matches.length > 1) {
    return { status: "multiple", labels: matches.map((area) => area.label) };
  }

  return { status: "single", area: matches[0] };
};
