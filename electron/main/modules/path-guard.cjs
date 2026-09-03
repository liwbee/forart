const path = require('path');

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isInsideOrEqual(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = { isInside, isInsideOrEqual };
