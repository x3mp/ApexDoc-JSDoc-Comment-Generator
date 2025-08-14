import * as fs from "fs";
import * as path from "path";

export type SnippetFolder = "ApexDoc" | "JSDoc";

const _snippetCache = new Map<string, string[]>();

export function loadSnippetBody(folder: SnippetFolder, name: string): string[] {
    const key = `${folder}/${name}`;
    const hit = _snippetCache.get(key);
    if (hit) return hit;

    const file = path.join(__dirname, "..", "snippets", folder, `${name}.json`);
    const json = JSON.parse(fs.readFileSync(file, "utf8"));

    let body: string[];
    if (Array.isArray(json.body)) {
        body = json.body as string[];
    } else {
        const firstKey = Object.keys(json)[0];
        body = json[firstKey].body;
    }
    _snippetCache.set(key, body);
    return body;
}
