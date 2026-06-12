/* eslint-disable */
// Nx workspace library project — the shape `nx generate @nx/jest` ships.
export default {
  displayName: 'shared-ui',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  globals: {},
  coverageDirectory: '../../coverage/libs/shared-ui',
  transform: {
    '^.+\\.[tj]sx?$': [
      'babel-jest',
      { presets: ['@nx/react/babel'], plugins: [] },
    ],
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  snapshotSerializers: [
    'jest-serializer-html',
  ],
  testEnvironment: 'jsdom',
};
