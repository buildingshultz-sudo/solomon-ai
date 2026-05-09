/**
 * Manus Import — bulk-ingests notes, plans, research docs, and task lists
 * produced during a Manus session into Solomon's long-term memory.
 *
 * The client uploads an array of {path, name, content} records (it can read
 * a folder via the File System Access API or a multi-select <input>). For each
 * file we:
 *   1. Auto-detect a memory category from the file path/name + content keywords.
 *   2. Split very large markdown files on H1/H2 headings so individual entries
 *      stay searchable. Small files become a single memory.
 *   3. Derive a title (front-matter title, first heading, or filename).
 *   4. Insert via upsertMemory with importance bumped for files that look like
 *      strategic plans or decisions.
 *
 * Returns a per-file report so the UI can show success/skip/error counts.
 */
import { upsertMemory } from "./memory";
import type { MemoryRow } from "./memory";

export type ImportFile = {
  path: string;
  name: string;
  content: string;
};

export type ImportFileResult = {
  path: string;
  name: string;
  status: "imported" | "skipped" | "error";
  category: MemoryRow["category"] | null;
  entries: number;
  message?: string;
};

export type ImportReport = {
  totalFiles: number;
  imported: number;
  skipped: number;
  errors: number;
  totalEntries: number;
  files: ImportFileResult[];
};

type Category = MemoryRow["category"];

// Lightweight keyword → category map. Path takes priority over content.
const PATH_HINTS: Array<[RegExp, Category]> = [
  [/(strategy|business[_-]?plan|playbook|vision|mission|roadmap|gtm|north[_-]?star)/i, "business_context"],
  [/(brand|voice|tone|style[_-]?guide|naming)/i, "brand_voice"],
  [/(decision|adr|rfc|memo|charter)/i, "decision"],
  [/(product|feature|spec|wireframe|design[_-]?doc|prd)/i, "project"],
  [/(market|launch|content|seo|social|youtube|tiktok|instagram|facebook|email[_-]?campaign)/i, "project"],
  [/(finance|budget|p&l|profit|cashflow|invoice|pricing|cogs)/i, "performance"],
  [/(metric|kpi|dashboard|analytics|performance|results|report)/i, "performance"],
  [/(preference|setup|config|how[_-]?i[_-]?work)/i, "preference"],
  [/(task|todo|to[_-]?do|backlog|sprint)/i, "project"],
  [/(research|note|notes|log|journal)/i, "general"],
];

const CONTENT_HINTS: Array<[RegExp, Category]> = [
  [/(brand voice|tone of voice|writing style|do not say|never say)/i, "brand_voice"],
  [/(decided to|chose to|we will|chose option|adr|rationale)/i, "decision"],
  [/(launch plan|content calendar|campaign|funnel|marketing plan)/i, "project"],
  [/(revenue|expense|cogs|profit|margin|ledger|invoice)/i, "performance"],
  [/(business plan|operating principles|mission|north star|vision)/i, "business_context"],
];

function autoCategory(file: ImportFile): Category {
  for (const [re, cat] of PATH_HINTS) {
    if (re.test(file.path) || re.test(file.name)) return cat;
  }
  for (const [re, cat] of CONTENT_HINTS) {
    if (re.test(file.content)) return cat;
  }
  return "general";
}

function autoImportance(file: ImportFile, category: Category): number {
  let score = 5;
  if (category === "decision" || category === "business_context") score += 2;
  if (category === "brand_voice") score += 1;
  if (/business[_-]?plan|charter|playbook|north[_-]?star|founding/i.test(file.path)) score += 2;
  if (file.content.length > 4000) score += 1;
  return Math.min(10, Math.max(1, score));
}

function deriveTags(file: ImportFile, category: Category): string {
  const segments = file.path.split(/[\\/]/).filter(Boolean);
  // Use parent folder names and the file stem (no extension) as tags.
  const parents = segments.slice(0, -1).slice(-3);
  const stem = (file.name || segments[segments.length - 1] || "")
    .replace(/\.[a-z0-9]+$/i, "");
  const raw = [...parents, stem, category, "manus_import"]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))
    .filter((t) => t && t.length > 1);
  return Array.from(new Set(raw)).slice(0, 8).join(",");
}

function deriveTitle(file: ImportFile): string {
  // 1. YAML front-matter title.
  const fm = file.content.match(/^---[\s\S]*?\ntitle:\s*"?([^"\n]+)"?/);
  if (fm && fm[1]) return fm[1].trim().slice(0, 240);
  // 2. First markdown heading.
  const h = file.content.match(/^\s*#{1,3}\s+(.+)$/m);
  if (h && h[1]) return h[1].trim().slice(0, 240);
  // 3. Filename stem, prettified.
  const stem = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return stem.slice(0, 240) || file.path.slice(-80);
}

const MAX_CHARS = 8000;
const MIN_CHARS = 80;

/**
 * Split very long markdown content on top-level headings so individual memories
 * stay searchable. Small files are returned as a single chunk.
 */
function chunkMarkdown(content: string): Array<{ title: string | null; body: string }> {
  if (content.length <= MAX_CHARS) {
    return [{ title: null, body: content }];
  }
  // Split on H1/H2 boundaries.
  const lines = content.split(/\r?\n/);
  const chunks: Array<{ title: string | null; body: string }> = [];
  let current: { title: string | null; body: string[] } = { title: null, body: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,2})\s+(.+)/);
    if (m) {
      if (current.body.join("\n").trim().length > MIN_CHARS) {
        chunks.push({ title: current.title, body: current.body.join("\n").trim() });
      }
      current = { title: m[2].trim().slice(0, 240), body: [line] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("\n").trim().length > MIN_CHARS) {
    chunks.push({ title: current.title, body: current.body.join("\n").trim() });
  }
  // If headings were absent, fall back to character chunking.
  if (chunks.length === 0) {
    for (let i = 0; i < content.length; i += MAX_CHARS) {
      chunks.push({ title: null, body: content.slice(i, i + MAX_CHARS) });
    }
  }
  return chunks;
}

/**
 * Ingest a batch of files into memory. The function never throws on a per-file
 * error; it records the failure and continues so a single bad file can't sink
 * the whole import.
 */
export async function importManusFiles(files: ImportFile[]): Promise<ImportReport> {
  const report: ImportReport = {
    totalFiles: files.length,
    imported: 0,
    skipped: 0,
    errors: 0,
    totalEntries: 0,
    files: [],
  };

  for (const f of files) {
    try {
      const content = (f.content ?? "").trim();
      if (!content || content.length < 20) {
        report.skipped++;
        report.files.push({
          path: f.path,
          name: f.name,
          status: "skipped",
          category: null,
          entries: 0,
          message: "Empty or too short",
        });
        continue;
      }

      const category = autoCategory(f);
      const importance = autoImportance(f, category);
      const tags = deriveTags(f, category);
      const baseTitle = deriveTitle(f);
      const chunks = chunkMarkdown(content);

      let entries = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const title =
          chunks.length === 1
            ? baseTitle
            : `${baseTitle}${c.title ? ` — ${c.title}` : ` (part ${i + 1})`}`;
        await upsertMemory({
          category,
          title: title.slice(0, 240),
          content: c.body,
          tags,
          importance,
          pinned: false,
          metadata: {
            source: "manus_import",
            path: f.path,
            chunkIndex: i,
            chunkCount: chunks.length,
          },
        });
        entries++;
      }

      report.imported++;
      report.totalEntries += entries;
      report.files.push({
        path: f.path,
        name: f.name,
        status: "imported",
        category,
        entries,
      });
    } catch (err) {
      report.errors++;
      report.files.push({
        path: f.path,
        name: f.name,
        status: "error",
        category: null,
        entries: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}
