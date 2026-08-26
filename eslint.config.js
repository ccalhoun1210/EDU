import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /*
     * Build and check scripts run under Node, not in a browser or a bundler.
     *
     * TypeScript files get their globals from `lib`, so `no-undef` is off for them; a plain
     * `.mjs` has no such source of truth and every Node global reads as undefined. Listed by
     * name rather than pulled from a `globals` package: a short list is not worth a dependency,
     * and an explicit list makes it visible when a script starts reaching for more.
     */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
      // Compliance decisions must be reproducible: no floating-point money math.
      // See CLAUDE.md invariant 5.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use a decimal library for money/ratio parsing.' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
