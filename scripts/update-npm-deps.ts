import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import semver from "semver";

function runTest(testCommand: string): boolean {
  try {
    execSync(testCommand, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function getAvailableVersions(pkgName: string): string[] {
  const result = execSync(`npm view ${pkgName} versions --json`, {
    encoding: "utf-8",
  });
  return JSON.parse(result) as string[];
}

function bumpVersion(
  current: string,
  versions: string[],
  bumpType: semver.ReleaseType,
): string | null {
  const next = semver.inc(current, bumpType);
  if (next && versions.includes(next)) {
    return next;
  }
  return null;
}

function updateDependencies(
  testCommand: string,
  bumpTypes: semver.ReleaseType[],
) {
  const pkgPath = path.resolve(`${process.cwd()}/package.json`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  const sections: Array<"dependencies" | "devDependencies"> = [
    "dependencies",
    "devDependencies",
  ];

  for (const section of sections) {
    const deps = pkg[section] || {};
    for (const [name, ver] of Object.entries(deps)) {
      const original = ver as string;
      const prefixMatch = original.match(/^[~^]/);
      const prefix = prefixMatch ? prefixMatch[0] : "";
      const cleanVer = semver.clean(original);
      if (!cleanVer) continue;

      console.log(`\nProcessing ${section} ${name}@${original}`);
      const versions = getAvailableVersions(name);

      for (const bump of bumpTypes) {
        const candidate = bumpVersion(cleanVer, versions, bump);
        if (!candidate) continue;

        const nextVer = prefix + candidate;
        console.log(`Trying ${name}@${nextVer}`);
        pkg[section][name] = nextVer;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

        try {
          execSync("npm install", { stdio: "inherit" });
        } catch {
          console.error("npm install failed, reverting");
          pkg[section][name] = original;
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
          execSync("npm install", { stdio: "ignore" });
          break;
        }

        if (runTest(testCommand)) {
          console.log(`Updated ${section} ${name} to ${nextVer}`);
          break;
        } else {
          console.error(`Tests failed for ${name}@${nextVer}, reverting`);
          pkg[section][name] = original;
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
          execSync("npm install", { stdio: "ignore" });
        }
      }
    }
  }
}

const args = process.argv.slice(2);
const usage =
  'Usage: update-dependencies.ts --test "<test command>" [--bump "<types>"]';
let testCommand = "";
let bumpTypes: semver.ReleaseType[] = ["patch", "minor", "major"];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--test" && args[i + 1]) {
    testCommand = args[i + 1];
    i++;
  } else if (args[i] === "--bump" && args[i + 1]) {
    bumpTypes = args[i + 1]
      .split(",")
      .map((b) => b.trim()) as semver.ReleaseType[];
    i++;
  } else {
    console.error(usage);
    process.exit(1);
  }
}

if (!testCommand) {
  console.error(usage);
  process.exit(1);
}

updateDependencies(testCommand, bumpTypes);
