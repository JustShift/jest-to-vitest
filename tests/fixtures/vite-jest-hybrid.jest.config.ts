// Vite app that still runs Jest for tests (a common pre-Vitest hybrid):
// aliases mirror vite.config.ts, ts-jest compiles, jsdom for components.
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@assets/(.*)$': '<rootDir>/src/assets/$1',
    '\\.(css|scss)$': 'identity-obj-proxy',
    '\\.svg$': 'jest-svg-transformer',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  reporters: ['default', ['jest-junit', { outputDirectory: 'reports/junit' }]],
  coverageThreshold: {
    global: { lines: 85, branches: 75 },
  },
  maxWorkers: 1,
};

export default config;
