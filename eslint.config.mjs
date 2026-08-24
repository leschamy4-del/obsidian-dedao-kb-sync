import tseslint from 'typescript-eslint';

// Type-aware linting (recommendedTypeChecked) matches the checks the Obsidian
// community scorecard runs, e.g. no-unsafe-* and no-misused-promises.
export default tseslint.config(
  { ignores: ['main.js', 'node_modules/'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
