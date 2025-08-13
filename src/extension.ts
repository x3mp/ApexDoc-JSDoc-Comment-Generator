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

    // Apex completions inside /** ... */
    const apexProvider = vscode.languages.registerCompletionItemProvider(
        "apex",
        {
            provideCompletionItems(document, position) {
                if (!insideDocBlock(document, position.line)) return;

                const decl = detectApexKindAndLine(document, position.line);
                const kind: ApexKind = decl?.kind ?? "class";

                const items: vscode.CompletionItem[] = [];

                // Common tags (keep @see suggestion-only; not in templates)
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

                // Inline link helpers
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

    // JSDoc completions for JS/TS (LWC/Aura)
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

/* =================== SNIPPET LOADER =================== */

function loadSnippetBody(folder: "ApexDoc" | "JSDoc", name: string): string[] {
    const file = path.join(__dirname, "..", "snippets", folder, `${name}.json`);
    if (!fs.existsSync(file)) {
        throw new Error(`Snippet not found: ${folder}/${name}.json`);
    }
    const json = JSON.parse(fs.readFileSync(file, "utf8"));

    // Simple shape: { "body": [...] }
    if (Array.isArray(json.body)) return json.body as string[];

    // VS Code snippet shape: { "Any Name": { "body": [...] } }
    const firstKey = Object.keys(json)[0];
    if (firstKey && Array.isArray(json[firstKey]?.body))
        return json[firstKey].body;

    throw new Error(`Invalid snippet format in ${folder}/${name}.json`);
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
            : kind; // class | method | property

    let lines = loadSnippetBody("ApexDoc", snippetName);

    // Methods & constructors: auto @param
    if (kind === "method" || kind === "constructor") {
        const params = getApexParams(doc, declLine, kind);
        if (params.length > 0) {
            const generated = params.map(
                (p: string) => `* @param ${p} description`
            );
            lines = replaceOrInjectApexParams(lines, generated);
        }
    }

    // Insert above contiguous annotation block (e.g., @AuraEnabled)
    const insertLine = findTopOfAnnotationBlock(doc, declLine);
    await editor.insertSnippet(
        new vscode.SnippetString(lines.join("\n") + "\n"),
        new vscode.Position(insertLine, 0)
    );
}

function detectApexKindAndLine(
    doc: vscode.TextDocument,
    fromLine: number
): { kind: ApexKind; line: number } | null {
    // If on/inside annotation run, prefer scanning downward first
    const lineText = doc.lineAt(fromLine).text;
    if (isAnnotationLine(lineText) || isInsideAnnotationRun(doc, fromLine)) {
        const downHit = findNextDeclDown(doc, fromLine);
        if (downHit) return downHit;
    }

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

function replaceOrInjectApexParams(
    lines: string[],
    generated: string[]
): string[] {
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

/* ===== Apex annotation helpers & “annotation-aware” detection ===== */

function isAnnotationLine(text: string): boolean {
    return text.trim().startsWith("@");
}

function isInsideAnnotationRun(
    doc: vscode.TextDocument,
    line: number
): boolean {
    const t = (n: number) =>
        n >= 0 && n < doc.lineCount ? doc.lineAt(n).text.trim() : "";
    const isAnnoOrBlank = (s: string) => s === "" || s.startsWith("@");

    let upHasAnno = false;
    for (let i = line; i >= Math.max(0, line - 10); i--) {
        const s = t(i);
        if (!isAnnoOrBlank(s)) break;
        if (s.startsWith("@")) upHasAnno = true;
    }

    let downHasAnno = false;
    for (let i = line; i <= Math.min(doc.lineCount - 1, line + 10); i++) {
        const s = t(i);
        if (!isAnnoOrBlank(s)) break;
        if (s.startsWith("@")) downHasAnno = true;
    }

    return upHasAnno || downHasAnno;
}

function findNextDeclDown(
    doc: vscode.TextDocument,
    fromLine: number
): { kind: ApexKind; line: number } | null {
    // Skip the current annotation block and blank lines
    let i = fromLine;
    while (i < doc.lineCount) {
        const s = doc.lineAt(i).text.trim();
        if (s === "" || s.startsWith("@")) {
            i++;
            continue;
        }
        break;
    }
    const limit = Math.min(doc.lineCount - 1, i + 200);
    for (let l = i; l <= limit; l++) {
        const k = apexKindAtLine(doc, l);
        if (k) return { kind: k, line: l };
    }
    return null;
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

/* =================== JS/TS (LWC & Aura) =================== */

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

    // Pick base template from /snippets/JSDoc
    const baseName =
        kind === "jsFunction"
            ? "functions"
            : kind === "jsMethod"
            ? "method"
            : "method"; // fallback for class/property (keeps it minimal)

    let lines = loadSnippetBody("JSDoc", baseName);

    // If function/method: auto-generate @param {any} name description and ensure @returns
    if (kind === "jsFunction" || kind === "jsMethod") {
        const params = getJsParams(doc, declLine);
        if (params.length) {
            const generated = params.map(
                (p, i) =>
                    ` * @param {any} ${p} ${
                        i === 0 ? "${2:description}" : "description"
                    }`
            );
            lines = replaceOrInjectJsParamsAndReturns(lines, generated);
        } else {
            lines = ensureReturnsInJSDoc(lines);
        }
    }

    // Insert above decorators (e.g., @api, @wire, @track)
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

    // class method shorthand: name(...) {
    if (/^\s*[A-Za-z_]\w*\s*\([^)]*\)\s*\{/.test(t)) return "jsMethod";

    // Aura helper object-literal: name: function (...) {
    if (/^\s*[A-Za-z_]\w*\s*:\s*function\s*\(/.test(t)) return "jsMethod";

    // function forms
    if (
        /^\s*export\s+function\s+[A-Za-z_]\w*\s*\(/.test(t) ||
        /^\s*function\s+[A-Za-z_]\w*\s*\(/.test(t) ||
        /^\s*const\s+[A-Za-z_]\w*\s*=\s*\(/.test(t) ||
        /^\s*const\s+[A-Za-z_]\w*\s*=\s*async\s*\(/.test(t) ||
        /^\s*const\s+[A-Za-z_]\w*\s*=\s*\w*\s*=>\s*\(/.test(t)
    ) {
        return "jsFunction";
    }

    // property (rough heuristic)
    if (/^\s*(public|private|protected)?\s*[A-Za-z_]\w*\s*[:=]\s*/.test(t))
        return "jsProperty";

    return null;
}

function getJsParams(doc: vscode.TextDocument, declLine: number): string[] {
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

function replaceOrInjectJsParamsAndReturns(
    lines: string[],
    generatedParams: string[]
): string[] {
    // Replace any existing " * @param " lines; if none, inject after @description
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
        if (line.trim().startsWith("* @param")) {
            if (!replaced) out.push(...generatedParams);
            replaced = true;
            continue;
        }
        out.push(line);
    }
    let result = out;
    if (!replaced) {
        const injected: string[] = [];
        let didInject = false;
        for (const line of out) {
            injected.push(line);
            if (!didInject && line.trim().startsWith("* @description")) {
                injected.push(...generatedParams);
                didInject = true;
            }
        }
        result = injected;
    }

    // Ensure a @returns exists
    const hasReturns = result.some((l) => l.trim().startsWith("* @returns"));
    if (!hasReturns) {
        const idxExample = result.findIndex((l) =>
            l.trim().startsWith("* @example")
        );
        const returnsLine = " * @returns {any} ${3:What is returned}";
        if (idxExample !== -1) {
            result.splice(idxExample, 0, returnsLine);
        } else {
            const closeIdx = Math.max(0, result.length - 1);
            result.splice(closeIdx, 0, returnsLine);
        }
    }
    return result;
}

function ensureReturnsInJSDoc(lines: string[]): string[] {
    const hasReturns = lines.some((l) => l.trim().startsWith("* @returns"));
    if (hasReturns) return lines;
    const result = [...lines];
    const idxExample = result.findIndex((l) =>
        l.trim().startsWith("* @example")
    );
    const returnsLine = " * @returns {any} ${2:What is returned}";
    if (idxExample !== -1) {
        result.splice(idxExample, 0, returnsLine);
    } else {
        const closeIdx = Math.max(0, result.length - 1);
        result.splice(closeIdx, 0, returnsLine);
    }
    return result;
}

/* =================== SHARED HELPERS =================== */

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
    item.insertText = label + " ";
    item.detail = "Doc tag";

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

function snippetItem(label: string, snippet: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Snippet
    );
    item.insertText = new vscode.SnippetString(snippet);
    return item;
}

function findTopOfJsDecoratorBlock(
    doc: vscode.TextDocument,
    declLine: number
): number {
    // LWC decorators are lines starting with @api, @wire, @track
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
