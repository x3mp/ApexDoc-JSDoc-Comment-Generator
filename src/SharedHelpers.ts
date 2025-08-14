import * as vscode from "vscode";

export function insideDocBlock(
    doc: vscode.TextDocument,
    line: number
): boolean {
    const trimmed = doc.lineAt(line).text.trim();
    if (trimmed.startsWith("/**") || trimmed.startsWith("*")) return true;
    const limit = Math.max(0, line - 100);
    for (let i = line; i >= limit; i--) {
        const t = doc.lineAt(i).text;
        if (t.includes("*/")) return false;
        if (t.includes("/**")) return true;
    }
    return false;
}

export function stripLineComments(s: string): string {
    return s.replace(/\/\/.*$/, "");
}

export function tagItem(
    label: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    detail: string = "Doc tag"
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Keyword
    );
    item.insertText = label + " ";
    item.detail = detail;

    // Overwrite a just-typed '@' to avoid '@@param'
    const prevPos = position.with(
        position.line,
        Math.max(0, position.character - 1)
    );
    const prevChar = document.getText(new vscode.Range(prevPos, position));
    if (prevChar === "@") {
        item.range = new vscode.Range(prevPos, position);
    }
    return item;
}

export function snippetItem(
    label: string,
    snippet: string
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Snippet
    );
    item.insertText = new vscode.SnippetString(snippet);
    return item;
}
