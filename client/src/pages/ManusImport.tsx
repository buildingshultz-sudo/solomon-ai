/**
 * Manus Import — bulk-load a folder of markdown / docs / notes into Solomon's
 * long-term memory in one click.
 *
 * UX:
 *   - Drag a folder onto the dropzone, OR click "Choose folder" / "Choose files"
 *     to pick a directory or specific files.
 *   - The page reads each file as text, sends them to `manusImport.ingest`,
 *     and renders the per-file report (category, entry count, errors).
 *
 * The server side handles parsing, category detection, chunking and
 * deduplication via memory.upsert.
 */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CheckCircle2, FileText, FolderOpen, Loader2, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Picked = { path: string; name: string; content: string };

const TEXT_EXTENSIONS = [
  ".md", ".markdown", ".txt", ".rtf",
  ".json", ".yaml", ".yml", ".csv", ".tsv",
  ".html", ".htm",
  ".js", ".ts", ".jsx", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".cs",
  ".sh", ".bat", ".ps1",
  ".sql", ".env",
  ".log",
];

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || !lower.includes(".");
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.readAsText(file);
  });
}

export default function ManusImport() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any | null>(null);

  const ingest = trpc.manusImport.ingest.useMutation({
    onSuccess: (r) => {
      setReport(r);
      toast.success(
        `Imported ${r.imported} of ${r.totalFiles} files — ${r.totalEntries} memory entries.`
      );
    },
    onError: (e) => toast.error(e.message),
  });

  async function handleFileList(rawFiles: FileList | null) {
    if (!rawFiles || rawFiles.length === 0) return;
    setLoading(true);
    setReport(null);
    const out: Picked[] = [];
    for (const f of Array.from(rawFiles)) {
      // webkitRelativePath is set by directory picker; fall back to name.
      const path = (f as any).webkitRelativePath || f.name;
      if (!isTextFile(f.name)) continue;
      if (f.size > 5 * 1024 * 1024) continue; // 5MB cap per file
      try {
        const content = await readAsText(f);
        out.push({ path, name: f.name, content });
      } catch (e) {
        // skip unreadable files
      }
    }
    setPicked(out);
    setLoading(false);
    if (out.length === 0) {
      toast.warning("No readable text files in that selection.");
    }
  }

  const totals = useMemo(() => {
    const bytes = picked.reduce((acc, p) => acc + p.content.length, 0);
    return { count: picked.length, kb: Math.round(bytes / 1024) };
  }, [picked]);

  function runImport() {
    if (picked.length === 0) {
      toast.warning("Choose a folder or files first.");
      return;
    }
    ingest.mutate({ files: picked });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Upload className="size-5 text-primary" /> Manus Import
        </h1>
        <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
          DROP A FOLDER · LOAD INTO SOLOMON'S MEMORY · ONE CLICK
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm solomon-stencil">PICK YOUR WORK</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={cn(
              "rounded-md border-2 border-dashed p-8 text-center transition-colors",
              loading ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40"
            )}
          >
            <FolderOpen className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Drop a folder or pick files</p>
            <p className="text-xs text-muted-foreground mt-1">
              Markdown, text, JSON, YAML, code, logs — Solomon will auto-categorize and load them into memory.
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen className="size-4 mr-1.5" /> Choose folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="size-4 mr-1.5" /> Choose files
              </Button>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              hidden
              // @ts-expect-error - non-standard but supported in Chromium/Edge
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => handleFileList(e.currentTarget.files)}
            />
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => handleFileList(e.currentTarget.files)}
            />
          </div>

          {picked.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <strong>{totals.count}</strong> file{totals.count === 1 ? "" : "s"} ready ·{" "}
                  <span className="text-muted-foreground">{totals.kb} KB</span>
                </div>
                <Button
                  size="sm"
                  onClick={runImport}
                  disabled={ingest.isPending || loading}
                >
                  {ingest.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-1.5 animate-spin" /> Importing…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4 mr-1.5" /> Import into Solomon
                    </>
                  )}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground max-h-40 overflow-auto rounded border bg-muted/30 p-2 font-mono">
                {picked.slice(0, 100).map((p) => (
                  <div key={p.path} className="truncate">{p.path}</div>
                ))}
                {picked.length > 100 && (
                  <div className="opacity-60 mt-1">…and {picked.length - 100} more</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm solomon-stencil">IMPORT REPORT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <Badge variant="outline" className="border-primary/40 text-primary">
                {report.imported} imported
              </Badge>
              <Badge variant="outline">{report.totalEntries} memory entries</Badge>
              {report.skipped > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {report.skipped} skipped
                </Badge>
              )}
              {report.errors > 0 && (
                <Badge variant="outline" className="text-destructive border-destructive/40">
                  {report.errors} errors
                </Badge>
              )}
            </div>

            <div className="text-xs max-h-72 overflow-auto rounded border bg-muted/20 divide-y">
              {report.files.map((f: any) => (
                <div
                  key={f.path}
                  className="flex items-start gap-2 px-3 py-2"
                >
                  {f.status === "imported" && <CheckCircle2 className="size-3.5 text-primary shrink-0 mt-0.5" />}
                  {f.status === "skipped" && <FileText className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                  {f.status === "error" && <XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono truncate">{f.path}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      {f.category && <span>{f.category}</span>}
                      {f.entries > 0 && <span>{f.entries} entr{f.entries === 1 ? "y" : "ies"}</span>}
                      {f.message && <span className="text-destructive">{f.message}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
