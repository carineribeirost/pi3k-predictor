import { existsSync, readdirSync } from "node:fs";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const features = existsSync("src/features") ? readdirSync("src/features") : [];

export default defineConfig(
  { ignores: ["dist", "src-tauri", "src/bindings"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "import-x": importX },
    settings: { "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".tsx", ".js"] })] },
    rules: {
      // Imports flow shared -> features -> app, and features never import each other.
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "./src/shared", from: ["./src/features", "./src/app"] },
            { target: "./src/features", from: "./src/app" },
            ...features.map((f) => ({ target: `./src/features/${f}`, from: "./src/features", except: [`./${f}`] })),
          ],
        },
      ],
      // All IPC goes through call() in shared/lib/ipc.ts.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@tauri-apps/api/core", importNames: ["invoke"], message: "Use call() from shared/lib/ipc." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/lib/ipc.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
