import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/"] },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "tests/**/*.ts"],
  })),
  { languageOptions: { parserOptions: { projectService: true } } },
);
