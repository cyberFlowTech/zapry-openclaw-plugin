import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import { ZapryApiClient } from "./api-client.js";
import type {
  ProfileSource,
  ProfileSourceSkill,
  ResolvedZapryAccount,
} from "./types.js";

const SKILL_KEY_RE = /^\s*skillKey:\s*["']?([^"'\n]+)["']?\s*$/m;
const SKILL_VERSION_RE = /^\s*skillVersion:\s*["']?([^"'\n]+)["']?\s*$/m;
const GENERIC_VERSION_RE = /^\s*version:\s*["']?([^"'\n]+)["']?\s*$/m;

// ── Public entry ──

export async function syncProfileToZapry(
  account: ResolvedZapryAccount,
  opts?: { projectRoot?: string; log?: any },
): Promise<void> {
  const log = opts?.log;
  const projectRoot = opts?.projectRoot || process.cwd();

  const soulPath = join(projectRoot, "SOUL.md");
  const soulRaw = await readFileSafe(soulPath);
  if (!soulRaw) {
    log?.debug?.(`[profile-sync] No SOUL.md found at ${soulPath}, skipping`);
    return;
  }

  const skills = await collectSkills(join(projectRoot, "skills"), projectRoot);
  if (skills.length === 0) {
    log?.debug?.(`[profile-sync] No skills found under ${join(projectRoot, "skills")}, skipping`);
    return;
  }

  const agentKey = basename(projectRoot);
  const snapshotId = computeSnapshotId(soulRaw, skills);

  const profileSource: ProfileSource = {
    version: "v1",
    source: "openclaw-plugin",
    agentKey,
    snapshotId,
    soulMd: soulRaw,
    skills,
  };

  const client = new ZapryApiClient(account.config.apiBaseUrl, account.botToken);

  log?.info?.(
    `[profile-sync] Registering profile: agent=${agentKey} skills=${skills.map((s) => s.skillKey).join(",")} snapshot=${snapshotId.slice(0, 12)}…`,
  );

  const resp = await client.setMyProfile({ profileSource });

  if (resp.ok) {
    const derived = (resp.result as any)?.derived ?? (resp as any).derived;
    const derivedName = derived?.profile?.name ?? "";
    const derivedSkills = derived?.profile?.skills?.length ?? 0;
    log?.info?.(
      `[profile-sync] Profile registered: name=${derivedName} derivedSkills=${derivedSkills} snapshot=${derived?.snapshotId?.slice(0, 12) ?? "?"}`,
    );

    const soulName = deriveNameFromSoul(soulRaw);
    if (soulName) {
      try {
        await client.setMyName(soulName);
        log?.info?.(`[profile-sync] Name synced: ${soulName}`);
      } catch (err) {
        log?.warn?.(
          `[profile-sync] setMyName fallback failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    log?.warn?.(
      `[profile-sync] setMyProfile failed: ${resp.error_code ?? "?"} ${resp.description ?? "unknown"}`,
    );
  }
}

// ── File discovery ──

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function collectSkills(
  skillsRoot: string,
  projectRoot: string,
): Promise<ProfileSourceSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch {
    return [];
  }

  const skills: ProfileSourceSkill[] = [];

  for (const entry of entries.sort()) {
    const skillMdPath = join(skillsRoot, entry, "SKILL.md");
    const raw = await readFileSafe(skillMdPath);
    if (!raw) continue;

    const frontmatter = extractFrontmatter(raw);
    const relPath = relative(projectRoot, skillMdPath).replace(/\\/g, "/");
    const skillKey = extractField(SKILL_KEY_RE, frontmatter) || entry;
    const skillVersion =
      extractField(SKILL_VERSION_RE, frontmatter) ||
      extractField(GENERIC_VERSION_RE, frontmatter) ||
      "1.0.0";

    skills.push({
      skillKey,
      skillVersion,
      source: "local",
      path: relPath,
      content: raw,
      sha256: sha256Hex(raw),
      bytes: Buffer.byteLength(raw, "utf-8"),
    });
  }

  return skills;
}

// ── Name extraction (mirrors Go SDK deriveNameFromSoul) ──

function deriveNameFromSoul(soul: string): string {
  const lines = soul.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith("#")) {
      let title = text.replace(/^#+\s*/, "");
      title = title.replace(/^SOUL\.md\s*-\s*/i, "").trim();
      return title;
    }
  }
  return "";
}

// ── Frontmatter / field extraction ──

function extractFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return "";
  const lines = normalized.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return "";
}

function extractField(re: RegExp, text: string): string {
  const m = re.exec(text);
  return m?.[1]?.trim() ?? "";
}

// ── Snapshot ID (matches Go SDK algorithm) ──

function computeSnapshotId(soulMd: string, skills: ProfileSourceSkill[]): string {
  const normalizedSoul = normalizeSoulMarkdown(soulMd);
  const normalizedIndex = normalizeSkillsIndex(skills);
  return sha256Hex(normalizedSoul + "\n" + normalizedIndex);
}

function normalizeSoulMarkdown(content: string): string {
  let c = content.replace(/^\uFEFF/, "");
  c = c.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  c = c
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  return c.replace(/[ \t\n]+$/, "");
}

function normalizeSkillsIndex(skills: ProfileSourceSkill[]): string {
  const sorted = [...skills].sort((a, b) => {
    if (a.skillKey === b.skillKey) return a.skillVersion < b.skillVersion ? -1 : 1;
    return a.skillKey < b.skillKey ? -1 : 1;
  });
  return sorted.map((s) => `${s.skillKey}|${s.skillVersion || "1.0.0"}|${s.sha256}`).join("\n");
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}
