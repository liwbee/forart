const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const NODES_DIR = path.join(__dirname, '..', 'renderer', 'src', 'features', 'infinite-canvas', 'nodes');
const ICONS_FILE = path.join(NODES_DIR, 'canvasNodeIcons.tsx');

function readTree(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return readTree(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [{ path: target, source: fs.readFileSync(target, 'utf8') }] : [];
  });
}

// Regression guard: the node decoration icons used to be `@iconify-react/*`
// components, whose Icon calls setState inside a mount effect. Grouping selects
// the new group node, which mounts its resize control; once that subtree was
// remounted often enough React aborted with "Maximum update depth exceeded" and
// WorkspaceErrorBoundary replaced the whole canvas with the error page. The
// icons are now static inline SVGs.
test('canvas node icons are static SVGs, not setState-in-effect icon packages', () => {
  const icons = fs.readFileSync(ICONS_FILE, 'utf8');
  assert.match(icons, /export function ResizeHandleIcon/);
  assert.match(icons, /export function ImageAiFillIcon/);
  assert.doesNotMatch(icons, /useState|useEffect|useLayoutEffect/);
});

test('canvas node rendering does not import iconify icon components', () => {
  const offenders = readTree(NODES_DIR)
    .filter((file) => /(?:from|require\()\s*["']@iconify/.test(file.source))
    .map((file) => path.relative(NODES_DIR, file.path));
  assert.deepEqual(offenders, []);
});
