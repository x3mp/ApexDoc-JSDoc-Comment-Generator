import * as vscode from "vscode";
import { loadSnippetBody } from "./SnippetLoader";
import {
    detectJsKindAndLine,
    findTopOfJsDecoratorBlock,
    getJsParams,
    replaceOrInjectJsParamsAndReturns,
    ensureReturnsInJSDoc,
    getAuraHelperPreambleInfo,
    hasLeadingJSDocHeader,
    inferJsVariableType,
    JsKind,
} from "./JSHelpers";
import { insideDocBlock, snippetItem, tagItem } from "./SharedHelpers";

export function registerJsProviders(context: vscode.ExtensionContext) {
    const jsTsProvider = vscode.languages.registerCompletionItemProvider(
        [{ language: "javascript" }, { language: "typescript" }],
        {
            provideCompletionItems(document, position) {
                if (!insideDocBlock(document, position.line)) return;

                // Detect kind around the cursor for better suggestions
                const decl = detectJsKindAndLine(document, position.line);
                const kind = decl?.kind ?? "jsFunction";

                const suggestions: vscode.CompletionItem[] = [];

                // Context-aware tags per JS kind
                const byKind: Record<JsKind, string[]> = {
                    jsFunction: [
                        "@description",
                        "@param",
                        "@returns",
                        "@throws",
                        "@example",
                        "@see",
                        "@async",
                        "@deprecated",
                    ],
                    jsMethod: [
                        "@description",
                        "@param",
                        "@returns",
                        "@throws",
                        "@example",
                        "@see",
                        "@async",
                        "@deprecated",
                    ],
                    jsVariable: [
                        "@description",
                        "@type",
                        "@private",
                        "@public",
                        "@readonly",
                        "@deprecated",
                        "@see",
                    ],
                    jsClass: ["@description", "@deprecated", "@see"],
                    jsProperty: [
                        "@description",
                        "@type",
                        "@private",
                        "@public",
                        "@readonly",
                        "@deprecated",
                        "@see",
                    ],
                };

                for (const tag of byKind[kind]) {
                    suggestions.push(
                        tagItem(tag, document, position, "JSDoc tag")
                    );
                }

                // Inline link helper
                suggestions.push(
                    snippetItem("{@link TypeOrURL}", "{@link ${1:TypeOrURL}}")
                );

                return suggestions;
            },
        },
        "@",
        "{"
    );
    context.subscriptions.push(jsTsProvider);
}

export async function generateJsFileHeader(editor: vscode.TextEditor) {
    const doc = editor.document;
    const auraInfo = getAuraHelperPreambleInfo(doc);
    if (
        auraInfo.isAuraHelper &&
        !hasLeadingJSDocHeader(doc, auraInfo.firstCodeLine)
    ) {
        const headerLines = loadSnippetBody("JSDoc", "file");
        await editor.insertSnippet(
            new vscode.SnippetString(headerLines.join("\n") + "\n"),
            new vscode.Position(0, 0)
        );
    } else {
        vscode.window.showInformationMessage(
            "File header already exists or this is not an Aura helper file."
        );
    }
}

export async function generateJsDoc(editor: vscode.TextEditor, here: number) {
    const doc = editor.document;

    // If cursor is on the Aura helper start "({", always insert file header (once)
    const thisLine = doc.lineAt(here).text.trim();
    if (/^\(\s*\{/.test(thisLine)) {
        const auraInfo = getAuraHelperPreambleInfo(doc);
        if (!hasLeadingJSDocHeader(doc, auraInfo.firstCodeLine)) {
            const headerLines = loadSnippetBody("JSDoc", "file");
            await editor.insertSnippet(
                new vscode.SnippetString(headerLines.join("\n") + "\n"),
                new vscode.Position(0, 0)
            );
            return;
        }
    }

    // Try to detect a declaration at cursor
    const detected = detectJsKindAndLine(doc, here);

    // If nothing detected, allow inserting a FILE HEADER only when cursor is at/above first code line
    if (!detected) {
        const auraInfo = getAuraHelperPreambleInfo(doc);
        const atTop = here <= auraInfo.firstCodeLine;
        if (
            auraInfo.isAuraHelper &&
            atTop &&
            !hasLeadingJSDocHeader(doc, auraInfo.firstCodeLine)
        ) {
            const headerLines = loadSnippetBody("JSDoc", "file");
            await editor.insertSnippet(
                new vscode.SnippetString(headerLines.join("\n") + "\n"),
                new vscode.Position(0, 0)
            );
            return;
        }
        vscode.window.showInformationMessage(
            "JSDoc: Could not detect a class/function/method/property/variable here."
        );
        return;
    }

    const { kind, line: declLine } = detected;

    // Variable: insert @type with inferred or annotated type
    if (kind === "jsVariable") {
        let lines = loadSnippetBody("JSDoc", "variable");
        const type = inferJsVariableType(doc, declLine) || "any";
        lines = lines.map((l) =>
            l.replace("{${1:any}}", `{${type}}`).replace("{any}", `{${type}}`)
        );

        await editor.insertSnippet(
            new vscode.SnippetString(lines.join("\n")),
            new vscode.Position(declLine, 0)
        );
        return;
    }

    // Base template for function/method/class/property
    const baseName =
        kind === "jsFunction"
            ? "functions"
            : kind === "jsMethod"
            ? "method"
            : "method"; // minimal fallback

    let lines = loadSnippetBody("JSDoc", baseName);

    // Auto @param and ensure @returns for functions/methods
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

    // Insert above decorators for LWC, or just above declaration
    const insertLine = findTopOfJsDecoratorBlock(doc, declLine);
    await editor.insertSnippet(
        new vscode.SnippetString(lines.join("\n") + "\n"),
        new vscode.Position(insertLine, 0)
    );
}
