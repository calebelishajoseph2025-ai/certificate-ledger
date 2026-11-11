module.exports = {
  ci: {
    collect: {
      url: ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/verify'],
      startServerCommand: 'npm run dev',
      startServerReadyPattern: 'Certificate Ledger server running',
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', {minScore: 0.9}],
        'categories:accessibility': ['error', {minScore: 0.95}],
        'categories:best-practices': ['warn', {minScore: 0.9}],
      },
    },
  },
};
