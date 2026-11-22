import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', '.superpowers', 'coverage', '.vercel'] },
  ...tseslint.configs.recommended,
  {
    files: ['api/**/*.ts', 'src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
  },
);
