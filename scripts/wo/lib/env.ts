import { readFile } from "node:fs/promises";

export const loadEnvFile = async (filePath: string) => {
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, valueRaw] = match;
    const value = valueRaw.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

export const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};
