const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Vite and Git ignore generation SQLite runtime files', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'vite.config.ts'), 'utf8');
  assert.match(source, /generation-tasks\.sqlite\*/);
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /^generation-tasks\.sqlite\*$/m);
});
