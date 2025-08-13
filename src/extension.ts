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
      const newBody: string[] = [];
      for (const line of snippetBody) {
        if (line.trim().startsWith("* @param")) {
          newBody.push(...paramLines);
        } else {
          newBody.push(line);
        }
      }
      snippetBody = newBody;
    }
  }

  const snippet = new vscode.SnippetString(snippetBody.join("\n"));

  // Insert ABOVE the current line
  const declLine = findDeclarationLine(editor, kind);
  const insertPos = new vscode.Position(declLine, 0);

  await editor.insertSnippet(snippet, insertPos);
}

function findDeclarationLine(editor: vscode.TextEditor, kind: string): number {
  const doc = editor.document;
  const cursorLine = editor.selection.active.line;

  const patterns: Record<string, RegExp> = {
    class:
      /^\s*(public|private|global|protected)?\s*(virtual|abstract)?\s*(class|interface|enum)\s+\w+/i,
    method:
      /^\s*(public|private|global|protected)?\s*(static)?\s*[\w<>\[\]]+\s+\w+\s*\(.*\)\s*({|;)?\s*$/i,
    property:
      /^\s*(public|private|global|protected)?\s*[\w<>\[\]]+\s+\w+\s*\{\s*get;\s*set;\s*\}/i,
  };

  const regex = patterns[kind];
  if (!regex) return cursorLine;

  for (let i = cursorLine; i >= 0; i--) {
    const line = doc.lineAt(i).text;
    if (regex.test(line)) {
      return i;
    }
  }

  return cursorLine;
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
