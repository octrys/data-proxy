import js from "@eslint/js";
import tseslint from 'typescript-eslint';
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        plugins: {
            js,
            tseslint
        },
        extends: [
            "js/recommended",
            "tseslint/recommended"
        ],
        rules: {
            "semi": "warn",
            "comma-dangle": "warn",
        }
    },
]);