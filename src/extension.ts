import * as vscode from "vscode";
import { registerApexProviders, generateApexDoc } from "./ApexHandler";
import {
    registerJsProviders,
    generateJsDoc,
    generateJsFileHeader,
} from "./JSHandler";

export function activate(context: vscode.ExtensionContext) {
    // Register completions/providers per language (fast & lazy)
    registerApexProviders(context);
    registerJsProviders(context);

    // Single generate command – routes by active language
    context.subscriptions.push(
        vscode.commands.registerCommand("apexdoc.generate", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const lang = editor.document.languageId;
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
        }),

        // Optional: explicit file header command (useful for Aura helpers)
        vscode.commands.registerCommand(
            "apexdoc.generateFileHeader",
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;
                const lang = editor.document.languageId;

                if (lang === "javascript" || lang === "typescript") {
                    await generateJsFileHeader(editor);
                } else if (lang === "apex") {
                    // You can add an Apex file header if you created snippets/ApexDoc/file.json
                    vscode.window.showInformationMessage(
                        "File header generator is currently implemented for JS/TS (Aura/LWC)."
                    );
                } else {
                    vscode.window.showInformationMessage(
                        "This command supports Apex, JavaScript, and TypeScript files."
                    );
                }
            }
        )
    );
}

export function deactivate() {}
