import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ensureDir = async (filePath: string) => {
  await mkdir(dirname(filePath), { recursive: true });
};

export const appendJsonl = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  const line = `${JSON.stringify(payload)}\n`;
  await writeFile(filePath, line, { flag: "a" });
};

export const readLastJsonlEntry = async <T,>(filePath: string): Promise<T | null> => {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    if (lines.length === 0 || !lines[0]) {
      return null;
    }
    const last = lines[lines.length - 1];
    if (!last) {
      return null;
    }
    return JSON.parse(last) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};
