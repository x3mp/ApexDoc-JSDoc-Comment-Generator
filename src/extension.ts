import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type Kind = "class" | "method" | "constructor" | "property" | "enumValue";

export function activate(context: vscode.ExtensionContext) {
  // One command
  context.subscriptions.push(
    vscode.commands.registerCommand("apexdoc.generate", () => generateApexDoc())
  );

  // Tiny completions inside /** ... */ for @tags and inline links
  const provider = vscode.languages.registerCompletionItemProvider(
    "apex",
    {
      provideCompletionItems(document, position) {
        if (!insideDocBlock(document, position.line)) return;

        const decl = detectKindAndLine(document, position.line);
        const kind: Kind = decl?.kind ?? "class";

        const items: vscode.CompletionItem[] = [];

        // Common tags
        const common = [
          "@description",
          "@see",
          "@example",
          "@author",
          "@date",
          "@group",
          "@group-content",
        ];
        for (const tag of common) items.push(tagItem(tag));

        // Kind-specific tags
        if (kind === "method" || kind === "constructor") {
          ["@param", "@return", "@throws"].forEach((t) =>
            items.push(tagItem(t))
          );
        } else if (kind === "property") {
          items.push(tagItem("@description"));
          items.push(tagItem("@see"));
        } else if (kind === "enumValue") {
          items.push(tagItem("@description"));
          items.push(tagItem("@see"));
        }

        // Inline link helpers
        const dblAngle = new vscode.CompletionItem(
          "<<TypeName>>",
          vscode.CompletionItemKind.Snippet
        );
        dblAngle.insertText = new vscode.SnippetString("<<${1:TypeName}>>");
        items.push(dblAngle);

        const jlink = new vscode.CompletionItem(
          "{@link TypeName}",
          vscode.CompletionItemKind.Snippet
        );
        jlink.insertText = new vscode.SnippetString("{@link ${1:TypeName}}");
        items.push(jlink);

        return items;
      },
    },
    "@",
    "{",
    "<" // trigger characters
  );
  context.subscriptions.push(provider);
}

export function deactivate() {}

/* ---------------- core ---------------- */

async function generateApexDoc(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  const here = editor.selection.active.line;

  const detected = detectKindAndLine(doc, here);
  if (!detected) {
    vscode.window.showInformationMessage(
      "ApexDoc: Could not detect a class/method/constructor/property/enum value here."
    );
    return;
  }

  const { kind, line: declLine } = detected;

  // pick snippet by kind (constructors reuse the "method" snippet)
  const snippetName = kind === "constructor" ? "method" : kind;
  const snippetPath = path.join(
    __dirname,
    "..",
    "snippets",
    `${snippetName}.json`
  );
  if (!fs.existsSync(snippetPath)) {
    vscode.window.showErrorMessage(
      `Snippet for "${snippetName}" not found at ${snippetPath}`
    );
    return;
  }

  const def = JSON.parse(fs.readFileSync(snippetPath, "utf-8")) as {
    body: string[];
  };
  let lines: string[] = Array.isArray(def.body) ? [...def.body] : [];

  // Methods & constructors: auto @param (and we keep @throws in snippet)
  if (kind === "method" || kind === "constructor") {
    const params = getMethodOrCtorParams(doc, declLine, kind);
    if (params.length > 0) {
      const generated = params.map((p) => `* @param ${p} description`);

      // Replace existing "* @param" lines; if none, inject after @description
      let replaced = false;
      const out: string[] = [];
      for (const line of lines) {
        if (line.trim().startsWith("* @param")) {
          if (!replaced) out.push(...generated);
          replaced = true;
          continue;
        }
        out.push(line);
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

  // Insert above contiguous annotation block (e.g., @AuraEnabled)
  const insertLine = findTopOfAnnotationBlock(doc, declLine);
  const insertPos = new vscode.Position(insertLine, 0);

  await editor.insertSnippet(
    new vscode.SnippetString(lines.join("\n") + "\n"),
    insertPos
  );
}

/* ---------------- detection helpers ---------------- */

function detectKindAndLine(
  doc: vscode.TextDocument,
  fromLine: number
): { kind: Kind; line: number } | null {
  const up = Math.max(0, fromLine - 200);
  const down = Math.min(doc.lineCount - 1, fromLine + 200);

  // up first
  for (let i = fromLine; i >= up; i--) {
    const kind = kindAtLine(doc, i);
    if (kind) return { kind, line: i };
  }
  // then down
  for (let i = fromLine + 1; i <= down; i++) {
    const kind = kindAtLine(doc, i);
    if (kind) return { kind, line: i };
  }
  return null;
}

function kindAtLine(doc: vscode.TextDocument, line: number): Kind | null {
  const t = stripLineComments(doc.lineAt(line).text);

  // enum VALUE (simple heuristic: ALLCAPS token on its own line, within an enum block ideally)
  if (/^\s*[A-Z0-9_]+\s*(=.+)?\s*,?\s*$/.test(t)) {
    if (isInsideEnumBlock(doc, line)) return "enumValue";
  }

  // constructor: modifiers + ClassName(...) (no return type)
  const className = findEnclosingClassName(doc, line);
  if (className) {
    const ctor = new RegExp(
      `^\\s*(public|private|protected|global)?\\s*${className}\\s*\\(`,
      "i"
    );
    if (ctor.test(t)) return "constructor";
  }

  // method: modifiers + returnType + name(...)
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

function isInsideEnumBlock(doc: vscode.TextDocument, line: number): boolean {
  // naive scan upwards for "enum <Name>" before encountering "class" or a matching "}"
  for (let i = line; i >= 0 && i >= line - 200; i--) {
    const txt = stripLineComments(doc.lineAt(i).text);
    if (/\b(class|interface)\b/i.test(txt)) return false;
    if (/\benum\s+[A-Za-z_]\w*/i.test(txt)) return true;
  }
  return false;
}

function findEnclosingClassName(
  doc: vscode.TextDocument,
  line: number
): string | null {
  for (let i = line; i >= 0 && i >= line - 400; i--) {
    const txt = stripLineComments(doc.lineAt(i).text);
    const m = txt.match(/\bclass\s+([A-Za-z_]\w*)/i);
    if (m) return m[1];
  }
  return null;
}

/* ---------------- parse params (methods & ctors) ---------------- */

function getMethodOrCtorParams(
  doc: vscode.TextDocument,
  declLine: number,
  kind: "method" | "constructor"
): string[] {
  const start = locateSignatureStart(doc, declLine, kind);
  if (start === -1) return [];

  let sig = "";
  let ended = false;
  const max = Math.min(doc.lineCount - 1, start + 50);
  for (let i = start; i <= max; i++) {
    const lineText = stripLineComments(doc.lineAt(i).text);
    sig += lineText + " ";
    if (sig.includes("(") && /\)\s*[{;]/.test(lineText)) {
      ended = true;
      break;
    }
  }
  if (!ended) return [];

  const m = sig.match(/\(([^)]*)\)/);
  if (!m) return [];
  const blob = m[1].trim();
  if (!blob) return [];

  return blob
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.split(/\s+/);
      const last = parts[parts.length - 1] || "";
      return last.replace(/[^A-Za-z0-9_]/g, "");
    })
    .filter(Boolean);
}

function locateSignatureStart(
  doc: vscode.TextDocument,
  declLine: number,
  kind: "method" | "constructor"
): number {
  const up = Math.max(0, declLine - 50);
  const down = Math.min(doc.lineCount - 1, declLine + 50);

  const className = findEnclosingClassName(doc, declLine);
  const ctorStart = className
    ? new RegExp(
        `^\\s*(public|private|protected|global)?\\s*${className}\\s*\\(`,
        "i"
      )
    : null;
  const methodStart =
    /^\s*(public|private|protected|global)?\s*(static\s+)?[\w<>\[\],\s?]+\s+[A-Za-z_]\w*\s*\(/i;

  for (let i = declLine; i >= up; i--) {
    const t = stripLineComments(doc.lineAt(i).text);
    if (kind === "constructor" && ctorStart && ctorStart.test(t)) return i;
    if (kind === "method" && methodStart.test(t)) return i;
  }
  for (let i = declLine + 1; i <= down; i++) {
    const t = stripLineComments(doc.lineAt(i).text);
    if (kind === "constructor" && ctorStart && ctorStart.test(t)) return i;
    if (kind === "method" && methodStart.test(t)) return i;
  }
  return -1;
}

/* ---------------- misc helpers ---------------- */

function findTopOfAnnotationBlock(
  doc: vscode.TextDocument,
  declLine: number
): number {
  let i = declLine - 1;
  while (i >= 0 && doc.lineAt(i).text.trim() === "") i--;
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

function insideDocBlock(doc: vscode.TextDocument, line: number): boolean {
  // scan up until /** or non-comment
  let sawOpen = false,
    sawClose = false;
  for (let i = line; i >= 0 && i >= line - 50; i--) {
    const t = doc.lineAt(i).text.trim();
    if (t.includes("*/")) {
      sawClose = true;
      break;
    }
    if (t.startsWith("/**")) {
      sawOpen = true;
      break;
    }
  }
  return sawOpen && !sawClose;
}

function stripLineComments(s: string): string {
  return s.replace(/\/\/.*$/, "");
}

function tagItem(label: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    label,
    vscode.CompletionItemKind.Keyword
  );
  item.insertText = label + " ";
  item.detail = "ApexDoc tag";
  return item;
}
