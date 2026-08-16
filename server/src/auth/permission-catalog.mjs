const LIBRARY_MODULES = [
  ["model_library", "模特库"],
  ["outfit_library", "搭配库"],
  ["action_library", "动作库"],
];

const LIBRARY_PERMISSIONS = [
  ["view", "查看"],
  ["project_edit", "编辑项目"],
  ["project_delete", "删除项目"],
  ["project_reorder", "项目排序"],
  ["entry_edit", "编辑素材"],
  ["entry_delete", "删除素材"],
  ["tag_manage", "管理标签"],
];

const SHARED_CANVAS_PERMISSIONS = [
  ["view", "查看"],
  ["project_edit", "编辑项目"],
  ["project_delete", "删除项目"],
  ["project_reorder", "项目排序"],
  ["canvas_edit", "编辑画布"],
  ["canvas_delete", "删除画布"],
  ["copy_to_local", "复制到本地"],
];

const ACTION_IMPLICATIONS = Object.freeze({
  project_delete: ["project_edit"],
  entry_delete: ["entry_edit"],
  canvas_delete: ["canvas_edit"],
});

function permissionDefinition(module, action, label) {
  return {
    key: `${module}.${action}`,
    module,
    action,
    label,
    implies: (ACTION_IMPLICATIONS[action] || []).map((impliedAction) => `${module}.${impliedAction}`),
  };
}

const FULL_PERMISSION_CATALOG = Object.freeze([
  ...LIBRARY_MODULES.flatMap(([module]) => LIBRARY_PERMISSIONS.map(([action, label]) => permissionDefinition(module, action, label))),
  ...SHARED_CANVAS_PERMISSIONS.map(([action, label]) => permissionDefinition("shared_canvas", action, label)),
]);

export const BASE_READ_PERMISSION_KEYS = Object.freeze(
  FULL_PERMISSION_CATALOG.filter((item) => item.action === "view").map((item) => item.key),
);

// Read access is a baseline capability for every authenticated member. The
// administrator only configures mutating or exporting capabilities.
export const PERMISSION_CATALOG = Object.freeze(
  FULL_PERMISSION_CATALOG.filter((item) => item.action !== "view"),
);

export const PERMISSION_KEYS = new Set(FULL_PERMISSION_CATALOG.map((item) => item.key));
export const ALL_PERMISSION_KEYS = Object.freeze([...PERMISSION_KEYS].sort());
const PERMISSION_BY_KEY = new Map(FULL_PERMISSION_CATALOG.map((item) => [item.key, item]));

export const PERMISSION_STATEMENTS = Object.freeze(
  FULL_PERMISSION_CATALOG.reduce((statements, item) => {
    const actions = statements[item.module] || [];
    if (!actions.includes(item.action)) actions.push(item.action);
    statements[item.module] = actions;
    return statements;
  }, {}),
);

export function expandPermissionKeys(values) {
  const expanded = new Set(BASE_READ_PERMISSION_KEYS);
  const pending = Array.isArray(values) ? [...values] : [];
  while (pending.length) {
    const key = String(pending.shift() || "");
    if (!PERMISSION_KEYS.has(key)) continue;
    if (expanded.has(key)) continue;
    expanded.add(key);
    for (const impliedKey of PERMISSION_BY_KEY.get(key)?.implies || []) pending.push(impliedKey);
  }
  return [...expanded].sort();
}

export function permissionKeysToStatement(values) {
  const statement = {};
  for (const key of expandPermissionKeys(values)) {
    if (!PERMISSION_KEYS.has(String(key || ""))) continue;
    const item = FULL_PERMISSION_CATALOG.find((entry) => entry.key === key);
    if (!item) continue;
    const actions = statement[item.module] || [];
    if (!actions.includes(item.action)) actions.push(item.action);
    statement[item.module] = actions;
  }
  return statement;
}

export function permissionStatementToKeys(statement) {
  const keys = [];
  if (!statement || typeof statement !== "object") return keys;
  for (const [module, actions] of Object.entries(statement)) {
    for (const action of Array.isArray(actions) ? actions : []) {
      const key = `${module}.${action}`;
      if (PERMISSION_KEYS.has(key)) keys.push(key);
    }
  }
  return [...new Set(keys)].sort();
}
