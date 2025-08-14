# ApexDoc & JSDoc Comment Generator

A lightweight Visual Studio Code extension to **automatically generate documentation comments** for Apex and JavaScript/TypeScript files (including Lightning Web Components and Aura helpers).

Supports:

-   **ApexDoc** comments for Apex classes, methods, properties, and enum values.
-   **JSDoc** comments for JS/TS classes, functions, methods, properties, and variables.
-   Context-aware generation (detects what you're on and inserts the right snippet).
-   Auto `@param` detection for methods/functions.
-   Proper placement **above annotations** (`@AuraEnabled`, `@api`, etc.).
-   Separate auto-suggest tag lists for ApexDoc and JSDoc.

---

## ✨ Features

-   **Right-click → Generate Doc Comment**: Automatically generates the correct comment type based on the cursor location.
-   **Auto @param parsing**: Reads function/method signatures and pre-fills parameters.
-   **Snippets stored in `snippets/` folder**: Easy to customize without touching code.
-   **Auto-suggest tags**: Type `@` inside a doc block and see relevant ApexDoc/JSDoc tags.
-   **LWC & Aura helper support**:
    -   For Aura helpers, right-click on the `({` line to insert a file header.
    -   For LWC, comments are inserted above decorators when present.

---

## 📦 Installation

### From VS Marketplace

1. Open your VS Extensions and search for ApexDoc & JSDoc Comment Generator.
2. Install the extension.
3. You're all ready to go!
