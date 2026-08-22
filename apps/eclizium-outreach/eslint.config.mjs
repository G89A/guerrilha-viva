import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'next-env.d.ts',
      'src/generated/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message: 'Use the "@/" path alias instead of deep relative imports.',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The logger is the single sanctioned place that writes to stdout.
    files: ['src/lib/logging/**/*.ts', 'prisma/seed.ts', 'scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
