import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type Kind = "class" | "method" | "property";

export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand("apexdoc.generate", () =>
    generateApexDoc()
  );
  context.subscriptions.push(cmd);
}

export function deactivate() {}

async function generateApexDoc(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  const fromLine = editor.selection.active.line;

  const detected = detectKindAndLine(doc, fromLine);
  if (!detected) {
    vscode.window.showInformationMessage(
      "ApexDoc: Could not detect class/method/property here."
    );
    return;
  }

  const { kind, line: declLine } = detected;

  // Load snippet JSON
  const snippetPath = path.join(__dirname, "..", "snippets", `${kind}.json`);
  if (!fs.existsSync(snippetPath)) {
    vscode.window.showErrorMessage(
      `Snippet for "${kind}" not found at ${snippetPath}`
    );
    return;
  }
  const raw = fs.readFileSync(snippetPath, "utf-8");
  const def = JSON.parse(raw) as { body: string[] };
  let lines: string[] = Array.isArray(def.body) ? [...def.body] : [];

  // For methods: generate @param lines from the actual signature
  if (kind === "method") {
    const params = getMethodParams(doc, declLine);
    if (params.length > 0) {
      const generated = params.map((p) => `* @param ${p} description`);

      // Replace any placeholder @param lines if present; else inject after @description
      let replaced = false;
      const out: string[] = [];
      for (const line of lines) {
        if (line.trim().startsWith("* @param")) {
          if (!replaced) out.push(...generated);
          replaced = true;
        } else {
          out.push(line);
        }
      }
      if (!replaced) {
        const injected: string[] = [];
        let didInject = false;
        for (const line of out) {
          injected.push(line);
          if (!didInject && line.trim().startsWith("* @description")) {
            injected.push(...generated);
            didInject = true;
          }
        }
        lines = injected;
      } else {
        lines = out;
      }
    }
  }

  // Insert above any annotation block that precedes the declaration
  const insertLine = findTopOfAnnotationBlock(doc, declLine);
  const insertPos = new vscode.Position(insertLine, 0);

  const snippet = new vscode.SnippetString(lines.join("\n") + "\n");
  await editor.insertSnippet(snippet, insertPos);
}

/* ---------------- helpers ---------------- */

function detectKindAndLine(
  doc: vscode.TextDocument,
  fromLine: number
): { kind: Kind; line: number } | null {
  const upLimit = Math.max(0, fromLine - 200);
  const downLimit = Math.min(doc.lineCount - 1, fromLine + 200);

  // Scan up first (usually cursor is inside the block)
  for (let i = fromLine; i >= upLimit; i--) {
    const k = kindAtLine(doc.lineAt(i).text);
    if (k) return { kind: k, line: i };
  }
  // Then down a bit
  for (let i = fromLine + 1; i <= downLimit; i++) {
    const k = kindAtLine(doc.lineAt(i).text);
    if (k) return { kind: k, line: i };
  }
  return null;
}

function kindAtLine(text: string): Kind | null {
  const t = text.replace(/\/\/.*$/, "");

  // method (start of signature)
  if (
    /^\s*(public|private|protected|global)?\s*(static\s+)?[\w<>\[\],\s?]+\s+[A-Za-z_]\w*\s*\(/i.test(
      t
    )
  ) {
    return "method";
  }
  // class/interface/enum
  if (
    /^\s*(public|private|protected|global)?\s*(virtual|abstract|with\s+sharing|without\s+sharing)?\s*(class|interface|enum)\s+[A-Za-z_]\w*/i.test(
      t
    )
  ) {
    return "class";
  }
  // property with get/set
  if (
    /^\s*(public|private|protected|global)?\s*(static\s+)?[\w<>\[\],\s?]+\s+[A-Za-z_]\w*\s*\{\s*get;\s*set;\s*\}/i.test(
      t
    )
  ) {
    return "property";
  }
  return null;
}

/** Insert above contiguous annotation lines (e.g., @AuraEnabled, @TestVisible) that appear immediately above decl. */
function findTopOfAnnotationBlock(
  doc: vscode.TextDocument,
  declLine: number
): number {
  let i = declLine - 1;
  // skip empty lines
  while (i >= 0 && doc.lineAt(i).text.trim() === "") i--;

  // climb through annotation lines
  while (i >= 0) {
    const txt = doc.lineAt(i).text.trim();
    if (txt.startsWith("@")) {
      i--;
      continue;
    }
    break;
  }
  return Math.max(0, i + 1);
}

/** Get param names from a (possibly multi-line) method starting at or above declLine. */
function getMethodParams(doc: vscode.TextDocument, declLine: number): string[] {
  const start = locateMethodStartLine(doc, declLine);
  if (start === -1) return [];

  let sig = "";
  let ended = false;
  const maxLook = Math.min(doc.lineCount - 1, start + 30);
  for (let i = start; i <= maxLook; i++) {
    const lineText = doc.lineAt(i).text.replace(/\/\/.*$/, "");
    sig += lineText + " ";
    if (sig.includes("(") && /\)\s*[{;]/.test(lineText)) {
      ended = true;
      break;
    }
  }
  if (!ended) return [];

  const match = sig.match(/\(([^)]*)\)/);
  if (!match) return [];
  const blob = match[1].trim();
  if (!blob) return [];

  return blob
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((p) => {
      const tokens = p.split(/\s+/);
      const last = tokens[tokens.length - 1] || "";
      return last.replace(/[^A-Za-z0-9_]/g, "");
    })
    .filter(Boolean);
}

/** Find line that contains method name + opening paren, near declLine. */
function locateMethodStartLine(
  doc: vscode.TextDocument,
  declLine: number
): number {
  const upLimit = Math.max(0, declLine - 50);
  const downLimit = Math.min(doc.lineCount - 1, declLine + 50);
  const methodStart =
    /^\s*(public|private|protected|global)?\s*(static\s+)?[\w<>\[\],\s?]+\s+[A-Za-z_]\w*\s*\(/i;

  for (let i = declLine; i >= upLimit; i--) {
    const t = doc.lineAt(i).text.replace(/\/\/.*$/, "");
    if (methodStart.test(t)) return i;
  }
  for (let i = declLine + 1; i <= downLimit; i++) {
    const t = doc.lineAt(i).text.replace(/\/\/.*$/, "");
    if (methodStart.test(t)) return i;
  }
  return -1;
}
