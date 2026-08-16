const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'renderer',
    'src',
    'features',
    'library-layout',
    'libraryProjectLoadState.ts',
  )).href);
}

const pending = { isPending: true, isSuccess: false };
const success = { isPending: false, isSuccess: true };

test('library projects stay loading until storage and project queries succeed', async () => {
  const { getLibraryProjectLoadState } = await loadModule();

  assert.equal(getLibraryProjectLoadState({
    hasFailure: false,
    storageConfigured: false,
    storageQuery: pending,
    projectsQuery: pending,
    projectCount: 0,
  }), 'loading');
  assert.equal(getLibraryProjectLoadState({
    hasFailure: false,
    storageConfigured: true,
    storageQuery: success,
    projectsQuery: pending,
    projectCount: 0,
  }), 'loading');
});

test('library projects only become empty after a successful project response', async () => {
  const { getLibraryProjectLoadState } = await loadModule();

  assert.equal(getLibraryProjectLoadState({
    hasFailure: false,
    storageConfigured: true,
    storageQuery: success,
    projectsQuery: success,
    projectCount: 0,
  }), 'empty');
  assert.equal(getLibraryProjectLoadState({
    hasFailure: false,
    storageConfigured: true,
    storageQuery: success,
    projectsQuery: success,
    projectCount: 2,
  }), 'ready');
});

test('library project errors and missing storage take precedence over empty data', async () => {
  const { getLibraryProjectLoadState } = await loadModule();

  assert.equal(getLibraryProjectLoadState({
    hasFailure: true,
    storageConfigured: true,
    storageQuery: pending,
    projectsQuery: pending,
    projectCount: 0,
  }), 'error');
  assert.equal(getLibraryProjectLoadState({
    hasFailure: false,
    storageConfigured: false,
    storageQuery: success,
    projectsQuery: pending,
    projectCount: 0,
  }), 'storage-unavailable');
});
