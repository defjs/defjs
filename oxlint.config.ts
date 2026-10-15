import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['typescript', 'import', 'vitest'],
  rules: {
    'import/no-namespace': 'error',
    'typescript/ban-ts-comment': [
      'error',
      {
        minimumDescriptionLength: 10,
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
      },
    ],
    'typescript/consistent-type-imports': [
      'error',
      {
        disallowTypeAnnotations: true,
        fixStyle: 'separate-type-imports',
        prefer: 'type-imports',
      },
    ],
    'typescript/no-explicit-any': 'error',
    'typescript/no-non-null-assertion': 'error',
    // Test-style rules are intentionally disabled: they flag pre-existing Vitest patterns (mock type
    // parameters, toThrow messages, conditional expects) that are outside the type-safety scope of
    // this task. They can be re-enabled in a dedicated test-quality pass.
    'vitest/expect-expect': 'off',
    'vitest/no-conditional-expect': 'off',
    'vitest/require-mock-type-parameters': 'off',
    'vitest/require-to-throw-message': 'off',
    'vitest/valid-title': 'off',
  },
})
