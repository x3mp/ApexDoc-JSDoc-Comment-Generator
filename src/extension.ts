import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  const kinds = ["class", "method", "property"];

  kinds.forEach((kind) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `apexdoc.insert${capitalize(kind)}Doc`,
        () => insertDoc(kind)
      )
    );
  });
}

async function insertDoc(kind: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const snippetPath = path.join(__dirname, "..", "snippets", `${kind}.json`);
  if (!fs.existsSync(snippetPath)) {
    vscode.window.showErrorMessage(`Snippet for "${kind}" not found.`);
    return;
  }

  let snippetDef = JSON.parse(fs.readFileSync(snippetPath, "utf-8"));
  let snippetBody = snippetDef.body.slice(); // clone array

  // Special handling for methods: auto-insert @param lines
  if (kind === "method") {
    const params = getMethodParams(editor);
    if (params.length > 0) {
      const paramLines = params.map((p) => `* @param ${p} description`);
      // Find where to insert params (replace placeholder ones in snippet)
      const newBody: string[] = [];
      for (const line of snippetBody) {
        if (line.trim().startsWith("* @param")) {
          // Replace with generated param lines
          newBody.push(...paramLines);
        } else {
          newBody.push(line);
        }
      }
      snippetBody = newBody;
    }
  }

  const snippet = new vscode.SnippetString(snippetBody.join("\n"));
  const pos = editor.selection.active;
  await editor.insertSnippet(snippet, pos);
}

function getMethodParams(editor: vscode.TextEditor): string[] {
  const cursorLine = editor.selection.active.line;
  const doc = editor.document;

  // Look at current and nearby lines to find method signature
  for (let i = cursorLine; i >= 0 && i > cursorLine - 5; i--) {
    const lineText = doc.lineAt(i).text.trim();
    const match = lineText.match(/^[\w<>]+\s+\w+\s*\(([^)]*)\)/);
    if (match && match[1]) {
      return match[1]
        .split(",")
        .map((p) => p.trim().split(/\s+/).pop() || "") // get last word as param name
        .filter(Boolean);
    }
  }
  return [];
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function deactivate() {}
