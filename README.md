# ApexDoc & JSDoc Comment Generator

A lightweight Visual Studio Code extension to **automatically generate documentation comments** for Apex and JavaScript/TypeScript files (including Lightning Web Components and Aura helpers).

## Supports:

-   **ApexDoc** comments for Apex classes, methods, properties, and enum values.
-   **JSDoc** comments for JS/TS classes, functions, methods, properties, and variables.
-   Context-aware generation (detects what you're on and inserts the right snippet).
-   Auto `@param` detection for methods/functions.
-   Proper placement **above annotations** (`@AuraEnabled`, `@api`, etc.).
-   Separate auto-suggest tag lists for ApexDoc and JSDoc.

## ✨ Features

-   **Right-click → Generate Doc Comment**: Automatically generates the correct comment type based on the cursor location.
-   **Auto @param parsing**: Reads function/method signatures and pre-fills parameters.
-   **Snippets stored in `snippets/` folder**: Easy to customize without touching code.
-   **Auto-suggest tags**: Type `@` inside a doc block and see relevant ApexDoc/JSDoc tags.
-   **LWC & Aura helper support**:
    -   For Aura helpers, right-click on the `({` line to insert a file header.
    -   For LWC, comments are inserted above decorators when present.

## 📦 Installation

### From VS Marketplace

1. Open your VS Extensions and search for ApexDoc & JSDoc Comment Generator.
2. Install the extension.
3. You're ready to go!

## ⚙️ VS Code Settings

For **tag auto-suggestions** to work, make sure comment suggestions are enabled:

```
"editor.quickSuggestions": {
  "comments": true,
  "strings": true,
  "other": true
},
"editor.suggestOnTriggerCharacters": true
```

At least the "other" comments are required.

## 📋 Supported ApexDoc Tags

| Tag              | Description                                         |
| ---------------- | --------------------------------------------------- |
| `@description`   | Description of the class/method/property/enum value |
| `@example`       | Example code usage                                  |
| `@group`         | Group name                                          |
| `@group-content` | Group content                                       |
| `@see`           | Related file or type                                |
| `@param`         | Method parameter                                    |
| `@return`        | Return value description                            |
| `@throws`        | Exception thrown by the method                      |
| Inline Links     | `<<TypeName>>` or `{@link TypeName}`                |

## 📋 Supported JSDoc Tags

| Tag              | Description                          |
| ---------------- | ------------------------------------ |
| @description     | Description of the element           |
| `@example`       | Example code usage                   |
| `@group`         | Group name                           |
| `@group-content` | Group content                        |
| `@see`           | Related file or type                 |
| `@param`         | Method parameter                     |
| `@return`        | Return value description             |
| `@throws`        | Exception thrown by the method       |
| Inline Links     | `<<TypeName>>` or `{@link TypeName}` |

## 🖱 Usage

1. Place your cursor on:
    - Apex class, method, property, or enum value.
    - JS/TS function, method, property, variable, or the ({ in an Aura helper.
2. **Right-click → Generate ApexDoc/JSDoc comment**.
3. Fill in placeholders (`${1:description}` etc.).

> 💡 **Tip**: For Aura helper file headers:
>
> Right-click exactly on the ({ line at the top of the file.

## 📂 Customizing Snippets

All templates are stored in:

```
snippets/
  ApexDoc/
    class.json
    method.json
    property.json
    enumValue.json
  JSDoc/
    file.json
    functions.json
    method.json
    property.json
    variable.json
```

Edit these to change default text, tags, or structure.

## 📜 License

[MIT](https://github.com/x3mp/ApexDoc-JSDoc-Comment-Generator/blob/main/LICENSE)
