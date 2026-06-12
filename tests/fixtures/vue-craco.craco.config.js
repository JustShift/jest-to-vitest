// CRACO config carrying an embedded jest block (Vue-flavored CRA hybrid).
const path = require('path');

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  babel: {
    presets: [],
  },
  style: {
    postcss: {},
  },
  jest: {
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '\\.(css|less|scss)$': 'identity-obj-proxy',
      '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/test/__mocks__/fileMock.js',
    },
    snapshotSerializers: ['jest-serializer-vue'],
    transform: {
      '^.+\\.vue$': '@vue/vue3-jest',
    },
    transformIgnorePatterns: ['node_modules/(?!(vuetify)/)'],
  },
};
