import * as vscode from "vscode";

export function insideDocBlock(
    doc: vscode.TextDocument,
    line: number
): boolean {
    const text = doc.lineAt(line).text;

    // Fast paths: opening line or any continuation '*'
    if (text.includes("/**")) return true;
    if (/^\s*\*/.test(text)) return true;

    // Walk up a bit: we’re inside if we see '/**' before '*/' or real code
    const start = Math.max(0, line - 80);
    for (let i = line; i >= start; i--) {
        const t = doc.lineAt(i).text;
        if (t.includes("*/")) return false; // closed before open -> not inside
        if (t.includes("/**")) return true; // found opener
        if (t.trim() !== "" && !/^\s*\/?\*/.test(t))
            // hit non-comment, non-blank
            return false;
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
