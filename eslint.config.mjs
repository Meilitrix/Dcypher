// Minimal, dependency-free ESLint flat config.
// Core style is enforced by .prettierrc.json + tsconfig (2-space indent, single
// quotes, semicolons, trailing commas). Add typescript-eslint plugins here when
// the team wants type-aware linting; kept light on purpose for the hackathon.
export default [
  {
    ignores: ['dist/', 'node_modules/', '.decypher-work/'],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
      indent: ['error', 2],
    },
  },
];
