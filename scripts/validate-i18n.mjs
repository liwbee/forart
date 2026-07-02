import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const namespacesDir = path.resolve("renderer/src/i18n/namespaces");
const sourceDir = path.resolve("renderer/src");

function collectKeys(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    keys.push(...collectKeys(child, prefix ? `${prefix}.${key}` : key));
  }
  return keys;
}

function diffKeys(left, right) {
  const rightSet = new Set(right);
  return left.filter((key) => !rightSet.has(key));
}

function hasNestedKey(value, keyPath) {
  let current = value;
  for (const key of keyPath.split(".")) {
    if (!current || typeof current !== "object" || !(key in current)) return false;
    current = current[key];
  }
  return true;
}

function walkSourceFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === path.resolve("renderer/src/i18n")) continue;
      walkSourceFiles(fullPath, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = fs.readdirSync(namespacesDir)
  .filter((file) => file.endsWith(".ts"))
  .sort();

let hasError = false;
const namespaceResources = new Map();

for (const file of files) {
  const namespace = path.basename(file, ".ts");
  const moduleUrl = pathToFileURL(path.join(namespacesDir, file)).href;
  const { zhCN, enUS } = await import(moduleUrl);
  namespaceResources.set(namespace, zhCN);
  const zhKeys = collectKeys(zhCN).sort();
  const enKeys = collectKeys(enUS).sort();
  const missingInEn = diffKeys(zhKeys, enKeys);
  const missingInZh = diffKeys(enKeys, zhKeys);

  if (missingInEn.length || missingInZh.length) {
    hasError = true;
    console.error(`\n${namespace}`);
    if (missingInEn.length) console.error(`  Missing in enUS: ${missingInEn.join(", ")}`);
    if (missingInZh.length) console.error(`  Missing in zhCN: ${missingInZh.join(", ")}`);
  }
}

const staticKeyPattern = /t\(\s*(["'])([A-Za-z][A-Za-z0-9]*):([^"'`{]+)\1/g;
const missingStaticKeys = [];

for (const file of walkSourceFiles(sourceDir)) {
  const source = fs.readFileSync(file, "utf8");
  let match;
  while ((match = staticKeyPattern.exec(source))) {
    const [, , namespace, key] = match;
    if (!namespaceResources.has(namespace) || !hasNestedKey(namespaceResources.get(namespace), key)) {
      missingStaticKeys.push(`${path.relative(path.resolve("."), file)} -> ${namespace}:${key}`);
    }
  }
}

if (missingStaticKeys.length) {
  hasError = true;
  console.error("\nMissing static i18n keys:");
  for (const key of missingStaticKeys) console.error(`  ${key}`);
}

if (hasError) {
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} i18n namespaces and static usages.`);
}
