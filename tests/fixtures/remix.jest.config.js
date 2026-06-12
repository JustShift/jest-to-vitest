// Remix app — the common community jest setup for Remix (esbuild-jest era).
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/setup-test-env.ts'],
  transform: {
    '^.+\\.tsx?$': 'esbuild-jest',
  },
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/app/$1',
  },
  testMatch: ['<rootDir>/app/**/*.test.{ts,tsx}'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/build/', '<rootDir>/public/build/'],
  collectCoverageFrom: ['app/**/*.{ts,tsx}', '!app/entry.*.tsx'],
  coverageReporters: ['text', 'lcov'],
};
