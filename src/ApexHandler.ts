import * as vscode from "vscode";
import { loadSnippetBody } from "./SnippetLoader";
import {
    ApexKind,
    detectApexKindAndLine,
    getApexParams,
    replaceOrInjectApexParams,
    findTopOfAnnotationBlock,
} from "./ApexHelpers";
import { insideDocBlock, snippetItem, tagItem } from "./SharedHelpers";

export function registerApexProviders(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        "apex",
        {
            provideCompletionItems(document, position) {
                if (!insideDocBlock(document, position.line)) return;

                const decl = detectApexKindAndLine(document, position.line);
                const kind: ApexKind = decl?.kind ?? "class";

                const suggestions: vscode.CompletionItem[] = [];

                const apexTags = [
                    "@description",
                    "@example",
                    "@author",
                    "@date",
                    "@group",
                    "@group-content",
                    "@see",
                ];
                for (const tag of apexTags) {
                    suggestions.push(
                        tagItem(tag, document, position, "ApexDoc tag")
                    );
                }

                if (kind === "method" || kind === "constructor") {
                    for (const tag of ["@param", "@return", "@throws"]) {
                        suggestions.push(
                            tagItem(tag, document, position, "ApexDoc tag")
                        );
                    }
                } else if (
                    kind === "property" ||
                    kind === "enumValue" ||
                    kind === "class"
                ) {
                    suggestions.push(
                        tagItem(
                            "@description",
                            document,
                            position,
                            "ApexDoc tag"
                        )
                    );
                }

                // Inline link helpers
                suggestions.push(
                    snippetItem("<<TypeName>>", "<<${1:TypeName}>>")
                );
                suggestions.push(
                    snippetItem("{@link TypeName}", "{@link ${1:TypeName}}")
                );

                return suggestions;
            },
        },
        "@",
        "{",
        "<"
    );
    context.subscriptions.push(provider);
}

export async function generateApexDoc(editor: vscode.TextEditor, here: number) {
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

    if (kind === "method" || kind === "constructor") {
        const params = getApexParams(doc, declLine, kind);
        if (params.length > 0) {
            const generated = params.map(
                (p: string) => `* @param ${p} description`
            );
            lines = replaceOrInjectApexParams(lines, generated);
        }
    }

    const insertLine = findTopOfAnnotationBlock(doc, declLine);
    await editor.insertSnippet(
        new vscode.SnippetString(lines.join("\n") + "\n"),
        new vscode.Position(insertLine, 0)
    );
}
