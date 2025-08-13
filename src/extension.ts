import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type ApexKind = "class" | "method" | "constructor" | "property" | "enumValue";
type JsKind = "jsClass" | "jsFunction" | "jsMethod" | "jsProperty";

export function activate(context: vscode.ExtensionContext) {
    // One command for both Apex & JS/TS
    context.subscriptions.push(
        vscode.commands.registerCommand("apexdoc.generate", () => generateDoc())
    );

    // Apex: completion for ApexDoc tags & inline link helpers
    const apexProvider = vscode.languages.registerCompletionItemProvider(
        "apex",
        {
            provideCompletionItems(document, position) {
                if (!insideDocBlock(document, position.line)) return;

                const decl = detectApexKindAndLine(document, position.line);
                const kind: ApexKind = decl?.kind ?? "class";

                const items: vscode.CompletionItem[] = [];

                // Common tags (note we pass document & position)
                const common = [
                    "@description",
                    "@see",
                    "@example",
                    "@author",
                    "@date",
                    "@group",
                    "@group-content",
                ];
                for (const tag of common)
                    items.push(tagItem(tag, document, position));

                if (kind === "method" || kind === "constructor") {
                    ["@param", "@return", "@throws"].forEach((t) =>
                        items.push(tagItem(t, document, position))
                    );
                } else if (
                    kind === "property" ||
                    kind === "enumValue" ||
                    kind === "class"
                ) {
                    items.push(tagItem("@description", document, position));
                }

                // Inline link helpers can stay as-is (no '@' issue)
                items.push(snippetItem("<<TypeName>>", "<<${1:TypeName}>>"));
                items.push(
                    snippetItem("{@link TypeName}", "{@link ${1:TypeName}}")
                );

                return items;
            },
        },
        "@",
        "{",
        "<"
    );
    context.subscriptions.push(apexProvider);

    // JS/TS (LWC): JSDoc completions
    const jsTsProvider = vscode.languages.registerCompletionItemProvider(
        [{ language: "javascript" }, { language: "typescript" }],
        {
            provideCompletionItems(document, position) {
                if (!insideDocBlock(document, position.line)) return;

                const items: vscode.CompletionItem[] = [];
                [
                    "@description",
                    "@param",
                    "@returns",
                    "@throws",
                    "@see",
                    "@example",
                    "@deprecated",
                ].forEach((tag) =>
                    items.push(tagItem(tag, document, position))
                );

                items.push(
                    snippetItem("{@link TypeOrURL}", "{@link ${1:TypeOrURL}}")
                );
                return items;
            },
        },
        "@",
        "{"
    );
    context.subscriptions.push(jsTsProvider);
}

export function deactivate() {}

/* =================== MAIN COMMAND =================== */

async function generateDoc(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    const lang = doc.languageId;
    const here = editor.selection.active.line;

    if (lang === "apex") {
        await generateApexDoc(editor, here);
    } else if (lang === "javascript" || lang === "typescript") {
        await generateJsDoc(editor, here);
    } else {
        vscode.window.showInformationMessage(
            "This command supports Apex, JavaScript, and TypeScript files."
        );
    }
}

/* =================== APEX =================== */

async function generateApexDoc(editor: vscode.TextEditor, here: number) {
    const doc = editor.document;
    const detected = detectApexKindAndLine(doc, here);
    if (!detected) {
        vscode.window.showInformationMessage(
            "ApexDoc: Could not detect a class/method/constructor/property/enum value here."
        );
        return;
    }
    const { kind, line: declLine } = detected;

    const snippetName =
        kind === "constructor"
            ? "method"
            : kind === "enumValue"
            ? "enumValue"
            : kind;
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

    // Methods & constructors: auto @param
    if (kind === "method" || kind === "constructor") {
        const params = getApexParams(doc, declLine, kind);
        if (params.length > 0) {
            const generated = params.map(
                (p: string) => `* @param ${p} description`
            );
            lines = replaceOrInjectParams(lines, generated);
        }
    }

    const insertLine = findTopOfAnnotationBlock(doc, declLine); // above @AuraEnabled etc.
    await editor.insertSnippet(
        new vscode.SnippetString(lines.join("\n") + "\n"),
        new vscode.Position(insertLine, 0)
    );
}

function detectApexKindAndLine(
    doc: vscode.TextDocument,
    fromLine: number
): { kind: ApexKind; line: number } | null {
    const up = Math.max(0, fromLine - 200);
    const down = Math.min(doc.lineCount - 1, fromLine + 200);

    for (let i = fromLine; i >= up; i--) {
        const k = apexKindAtLine(doc, i);
        if (k) return { kind: k, line: i };
    }
    for (let i = fromLine + 1; i <= down; i++) {
        const k = apexKindAtLine(doc, i);
        if (k) return { kind: k, line: i };
    }
    return null;
}

function apexKindAtLine(
    doc: vscode.TextDocument,
    line: number
): ApexKind | null {
    const t = stripLineComments(doc.lineAt(line).text);

    // enum value
    if (
        /^\s*[A-Z0-9_]+\s*(=.+)?\s*,?\s*$/.test(t) &&
        isInsideEnumBlock(doc, line)
    )
        return "enumValue";

    // constructor
    const className = findEnclosingClassName(doc, line);
    if (className) {
        const ctor = new RegExp(
            `^\\s*(public|private|protected|global)?\\s*${className}\\s*\\(`,
            "i"
        );
        if (ctor.test(t)) return "constructor";
    }

    // method
    if (
        /^\s*(public|private|protected|global)?\s*(static\s+)?[\w<>\[\],\s?]+\s+[A-Za-z_]\w*\s*\(/i.test(
            t
        )
    )
        return "method";

    // class/interface/enum
    if (
        /^\s*(public|private|protected|global)?\s*(virtual|abstract|with\s+sharing|without\s+sharing)?\s*(class|interface|enum)\s+[A-Za-z_]\w*/i.test(
            t
        )
    ) {
        return "class";
    }

    // property
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

function getApexParams(
    doc: vscode.TextDocument,
    declLine: number,
    kind: "method" | "constructor"
): string[] {
    const start = locateApexSignatureStart(doc, declLine, kind);
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

function locateApexSignatureStart(
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

/* =================== JS/TS (LWC) =================== */

async function generateJsDoc(editor: vscode.TextEditor, here: number) {
    const doc = editor.document;
    const detected = detectJsKindAndLine(doc, here);
    if (!detected) {
        vscode.window.showInformationMessage(
            "JSDoc: Could not detect a class/function/method/property here."
        );
        return;
    }
    const { kind, line: declLine } = detected;

    // Minimal JSDoc blocks; we don’t store JS snippets on disk to keep it simple
    let lines: string[] = ["/**", " * @description ${1:Describe this}", " */"];

    if (kind === "jsFunction" || kind === "jsMethod") {
        const params = getJsParams(doc, declLine);
        if (params.length) {
            // Build a richer JSDoc for functions/methods
            lines = [
                "/**",
                " * @description ${1:Describe this}",
                ...params.map(
                    (p, i) =>
                        ` * @param {${i ? "any" : "any"}} ${p} ${
                            i ? "description" : "description"
                        }`
                ),
                " * @returns {any} ${2:What is returned}",
                " * @example",
                " * // example here",
                " */",
            ];
        } else {
            lines = [
                "/**",
                " * @description ${1:Describe this}",
                " * @returns {any} ${2:What is returned}",
                " * @example",
                " * // example here",
                " */",
            ];
        }
    }

    // Insert above decorators like @api/@wire/@track if present
    const insertLine = findTopOfJsDecoratorBlock(doc, declLine);
    await editor.insertSnippet(
        new vscode.SnippetString(lines.join("\n") + "\n"),
        new vscode.Position(insertLine, 0)
    );
}

function detectJsKindAndLine(
    doc: vscode.TextDocument,
    fromLine: number
): { kind: JsKind; line: number } | null {
    const up = Math.max(0, fromLine - 200);
    const down = Math.min(doc.lineCount - 1, fromLine + 200);

    for (let i = fromLine; i >= up; i--) {
        const k = jsKindAtLine(doc.lineAt(i).text);
        if (k) return { kind: k, line: i };
    }
    for (let i = fromLine + 1; i <= down; i++) {
        const k = jsKindAtLine(doc.lineAt(i).text);
        if (k) return { kind: k, line: i };
    }
    return null;
}

function jsKindAtLine(text: string): JsKind | null {
    const t = stripLineComments(text);

    // class
    if (
        /^\s*export\s+default\s+class\s+[A-Za-z_]\w*/.test(t) ||
        /^\s*class\s+[A-Za-z_]\w*/.test(t)
    )
        return "jsClass";

    // method inside class: name(...) {  (heuristic)
    if (/^\s*[A-Za-z_]\w*\s*\([^)]*\)\s*\{/.test(t)) return "jsMethod";

    // function
    if (
        /^\s*export\s+function\s+[A-Za-z_]\w*\s*\(|^\s*function\s+[A-Za-z_]\w*\s*\(|^\s*const\s+[A-Za-z_]\w*\s*=\s*\(/.test(
            t
        )
    ) {
        return "jsFunction";
    }

    // property (very rough)
    if (/^\s*(public|private|protected)?\s*[A-Za-z_]\w*\s*[:=]\s*/.test(t))
        return "jsProperty";

    return null;
}

function getJsParams(doc: vscode.TextDocument, declLine: number): string[] {
    // Read a few lines to get (...) in function/method
    const max = Math.min(doc.lineCount - 1, declLine + 10);
    let sig = "";
    for (let i = declLine; i <= max; i++) {
        const tx = stripLineComments(doc.lineAt(i).text);
        sig += tx + " ";
        if (tx.includes(")")) break;
    }
    const m = sig.match(/\(([^)]*)\)/);
    if (!m) return [];
    const blob = m[1].trim();
    if (!blob) return [];
    return blob
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => p.replace(/=.*$/, "")) // drop default values
        .map((p) => p.replace(/[\{\}\[\]]/g, "")) // drop destructuring braces
        .map((p) => p.split(":")[0].trim()) // TS param: name: Type
        .map((p) => p.replace(/[^A-Za-z0-9_]/g, ""))
        .filter(Boolean);
}

/* =================== SHARED HELPERS =================== */

function replaceOrInjectParams(lines: string[], generated: string[]): string[] {
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
        return injected;
    }
    return out;
}

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

function findTopOfJsDecoratorBlock(
    doc: vscode.TextDocument,
    declLine: number
): number {
    // LWC decorators are lines starting with @api, @wire, @track, @api readonly, etc.
    let i = declLine - 1;
    while (i >= 0 && doc.lineAt(i).text.trim() === "") i--;
    while (i >= 0) {
        const txt = doc.lineAt(i).text.trim();
        if (/^@(?:api|wire|track)\b/.test(txt)) {
            i--;
            continue;
        }
        break;
    }
    return Math.max(0, i + 1);
}

function insideDocBlock(doc: vscode.TextDocument, line: number): boolean {
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

function stripLineComments(s: string): string {
    return s.replace(/\/\/.*$/, "");
}

function tagItem(
    label: string,
    document: vscode.TextDocument,
    position: vscode.Position
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Keyword
    );

    // Always insert the full tag (with '@')
    item.insertText = label + " ";
    item.detail = "Doc tag";

    // If the user just typed '@', overwrite it so we don't get '@@param'
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

function snippetItem(label: string, snippet: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Snippet
    );
    item.insertText = new vscode.SnippetString(snippet);
    return item;
}
