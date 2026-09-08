module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // @stellar/stellar-sdk depends on packages published as ESM only. Jest does
  // not transform node_modules by default, so importing anything that reaches
  // the SDK fails to parse ("Unexpected token 'export'") unless these are
  // explicitly transformed.
  // The negative lookahead scans the rest of the path rather than just the next
  // segment, so nested copies (e.g. stellar-sdk's own @noble/hashes) are
  // matched too.
  transformIgnorePatterns: [
    '/node_modules/(?!.*(@exodus/bytes|@noble/curves|@noble/ed25519|@noble/hashes|eventsource|smol-toml|uint8array-extras)/)',
  ],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
};
