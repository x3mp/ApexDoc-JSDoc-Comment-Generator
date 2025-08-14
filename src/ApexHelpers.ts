import * as vscode from "vscode";
import { stripLineComments } from "./SharedHelpers";

export type ApexKind =
    | "class"
    | "method"
    | "constructor"
    | "property"
    | "enumValue";

export function detectApexKindAndLine(
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

export function apexKindAtLine(
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

export function isInsideEnumBlock(
    doc: vscode.TextDocument,
    line: number
): boolean {
    for (let i = line; i >= 0 && i >= line - 200; i--) {
        const txt = stripLineComments(doc.lineAt(i).text);
        if (/\b(class|interface)\b/i.test(txt)) return false;
        if (/\benum\s+[A-Za-z_]\w*/i.test(txt)) return true;
    }
    return false;
}

export function findEnclosingClassName(
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

export function getApexParams(
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

export function locateApexSignatureStart(
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

export function replaceOrInjectApexParams(
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

/* ---- annotation-aware helpers ---- */

export function isAnnotationLine(text: string): boolean {
    return text.trim().startsWith("@");
}

export function isInsideAnnotationRun(
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

export function findNextDeclDown(
    doc: vscode.TextDocument,
    fromLine: number
): { kind: ApexKind; line: number } | null {
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

export function findTopOfAnnotationBlock(
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
