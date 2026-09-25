// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    // Nest reads constructor and handler parameter types from the emitted
    // decorator metadata. A type-only import erases the class, so services
    // can no longer be injected and DTOs are no longer validated.
    files: ['src/**/*.controller.ts', 'src/**/*.gateway.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[importKind="type"][source.value=/\\.(service|dto|entity)$/]',
          message:
            'Use a value import: `import type` breaks dependency injection and DTO validation.',
        },
        {
          selector:
            'ImportDeclaration[source.value=/\\.(service|dto|entity)$/] > ImportSpecifier[importKind="type"]',
          message:
            'Use a value import: `import type` breaks dependency injection and DTO validation.',
        },
      ],
    },
  },
);
