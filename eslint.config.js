import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.claude/**'] },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  ...pluginVue.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['packages/web/**/*.vue'],
  })),
  {
    // <script lang="ts"> in SFCs; no type-aware rules on .vue (spec 02, step 2).
    files: ['packages/web/**/*.vue'],
    extends: [tseslint.configs.base, tseslint.configs.disableTypeChecked],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'vue/no-v-html': 'error',
      // Template layout belongs to Prettier; these stylistic rules fight it.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      // Prettier writes `<input />`; accept both forms on void elements.
      'vue/html-self-closing': ['warn', { html: { void: 'any' } }],
    },
  },
  {
    // Plain JS config files are not part of any tsconfig project.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
