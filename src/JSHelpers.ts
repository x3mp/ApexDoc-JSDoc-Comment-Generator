import * as vscode from "vscode";
import { stripLineComments } from "./SharedHelpers";

export type JsKind =
    | "jsClass"
    | "jsFunction"
    | "jsMethod"
    | "jsProperty"
    | "jsVariable";

export function detectJsKindAndLine(
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

export function jsKindAtLine(text: string): JsKind | null {
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
    )
        return "jsFunction";

    // variable (const/let/var foo [: Type]? = ...)
    if (/^\s*(const|let|var)\s+[A-Za-z_]\w*\s*([=:]|$)/.test(t))
        return "jsVariable";

    // property (rough heuristic)
    if (/^\s*(public|private|protected)?\s*[A-Za-z_]\w*\s*[:=]\s*/.test(t))
        return "jsProperty";

    return null;
}

export function getJsParams(
    doc: vscode.TextDocument,
    declLine: number
): string[] {
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

export function replaceOrInjectJsParamsAndReturns(
    lines: string[],
    generatedParams: string[]
): string[] {
    // Replace any existing @param lines (robust against missing leading '* ')
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\*?\s*@param\b/.test(trimmed)) {
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
            if (!didInject && /^\s*\*\s*@description\b/.test(line)) {
                injected.push(...generatedParams);
                didInject = true;
            }
        }
        result = injected;
    }

    // Ensure a single @returns
    const hasReturns = result.some((l) => l.trim().match(/^\*?\s*@returns\b/));
    if (!hasReturns) {
        const returnsLine = " * @returns {any} ${3:What is returned}";
        const idxExample = result.findIndex((l) =>
            l.trim().match(/^\*\s*@example\b/)
        );
        if (idxExample !== -1) {
            result.splice(idxExample, 0, returnsLine);
        } else {
            const closeIdx = Math.max(0, result.length - 1);
            result.splice(closeIdx, 0, returnsLine);
        }
    }
    return result;
}

export function ensureReturnsInJSDoc(lines: string[]): string[] {
    const hasReturns = lines.some((l) => l.trim().match(/^\*?\s*@returns\b/));
    if (hasReturns) return lines;
    const result = [...lines];
    const returnsLine = " * @returns {any} ${2:What is returned}";
    const idxExample = result.findIndex((l) =>
        l.trim().match(/^\*\s*@example\b/)
    );
    if (idxExample !== -1) {
        result.splice(idxExample, 0, returnsLine);
    } else {
        const closeIdx = Math.max(0, result.length - 1);
        result.splice(closeIdx, 0, returnsLine);
    }
    return result;
}

/* ---- LWC/Aura helpers ---- */

export function findTopOfJsDecoratorBlock(
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

export function getAuraHelperPreambleInfo(doc: vscode.TextDocument): {
    isAuraHelper: boolean;
    firstCodeLine: number;
} {
    let i = 0;
    if (doc.lineCount === 0) return { isAuraHelper: false, firstCodeLine: 0 };

    if (doc.lineAt(0).text.startsWith("#!")) i++; // shebang

    while (i < doc.lineCount) {
        const t = doc.lineAt(i).text.trim();
        if (t === "" || t.startsWith("//")) {
            i++;
            continue;
        }
        break;
    }

    const first = doc.lineAt(i).text.trim();
    const isAura = /^\(\s*\{/.test(first); // starts with "({"
    return { isAuraHelper: isAura, firstCodeLine: i };
}

export function hasLeadingJSDocHeader(
    doc: vscode.TextDocument,
    beforeLine: number
): boolean {
    for (let i = 0; i < Math.min(beforeLine, doc.lineCount); i++) {
        const t = doc.lineAt(i).text.trim();
        if (t.startsWith("/**")) return true;
        if (t && !t.startsWith("//")) break; // non-comment code encountered
    }
    return false;
}

export function inferJsVariableType(
    doc: vscode.TextDocument,
    line: number
): string | null {
    const text = stripLineComments(doc.lineAt(line).text);

    // TS annotation: const foo: Type = ...
    const ann = text.match(/^\s*(const|let|var)\s+[A-Za-z_]\w*\s*:\s*([^=;]+)/);
    if (ann) {
        const tsType = ann[2].trim();
        return tsType;
    }

    // Initializer inference
    const init = text.match(/=\s*(.+?)(;|$)/);
    if (!init) return null;
    const rhs = init[1].trim();

    if (/^(['"]).*\1$/.test(rhs)) return "string";
    if (/^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/i.test(rhs)) return "number";
    if (/^(true|false)\b/.test(rhs)) return "boolean";
    if (/^\[.*\]$/.test(rhs)) return "Array<any>";
    if (/^\{.*\}$/.test(rhs)) return "Object";
    if (
        /^function\b/.test(rhs) ||
        /^\(*[A-Za-z0-9_,\s\{\}\[\]]*\)*\s*=>/.test(rhs)
    )
        return "Function";
    const ctor = rhs.match(/^new\s+([A-Za-z_]\w*)\s*\(/);
    if (ctor) return ctor[1];

    return null;
}
