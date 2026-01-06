/**
 * Jest Configuration for Backend Testing
 */

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/server', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/**/*.test.js',
    '!server/db/migrations/**',
    '!server/data/**',
  ],
  coverageDirectory: 'coverage/backend',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js'],
  testTimeout: 30000,
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};





