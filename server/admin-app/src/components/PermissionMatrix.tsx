import { useEffect, useMemo, useRef } from "react";
import type { PermissionDefinition } from "../types";

const LIBRARY_MODULES = [
  ["model_library", "模特库"],
  ["outfit_library", "搭配库"],
  ["action_library", "动作库"],
] as const;

const LIBRARY_ACTIONS = ["project_edit", "project_delete", "project_reorder", "entry_edit", "entry_delete", "tag_manage"] as const;

function PermissionCheckbox({ checked, indeterminate = false, disabled = false, label, onChange }: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={inputRef} checked={checked} disabled={disabled} aria-label={label} type="checkbox" onChange={(event) => onChange(event.target.checked)} />;
}

export function PermissionMatrix({ catalog, permissions, disabled = false, onChange }: {
  catalog: PermissionDefinition[];
  permissions: string[];
  disabled?: boolean;
  onChange: (permissions: string[]) => void;
}) {
  const permissionsByKey = useMemo(() => new Map(catalog.map((permission) => [permission.key, permission])), [catalog]);
  const impliedBy = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const permission of catalog) {
      for (const impliedKey of permission.implies || []) {
        result.set(impliedKey, [...(result.get(impliedKey) || []), permission.key]);
      }
    }
    return result;
  }, [catalog]);
  const libraryColumns = useMemo(() => LIBRARY_ACTIONS.map((action) => ({
    action,
    label: permissionsByKey.get(`model_library.${action}`)?.label || action,
  })), [permissionsByKey]);
  const canvasPermissions = useMemo(() => catalog.filter((permission) => permission.module === "shared_canvas"), [catalog]);

  function setPermissionKeys(keys: string[], enabled: boolean) {
    if (!enabled) {
      const keySet = new Set(keys);
      const remaining = permissions.filter((key) => !keySet.has(key));
      const next = new Set(remaining);
      for (const key of remaining) {
        for (const impliedKey of permissionsByKey.get(key)?.implies || []) next.add(impliedKey);
      }
      onChange([...next]);
      return;
    }
    const next = new Set(permissions);
    const pending = [...keys];
    while (pending.length) {
      const key = pending.shift();
      if (!key || next.has(key)) continue;
      next.add(key);
      pending.push(...(permissionsByKey.get(key)?.implies || []));
    }
    onChange([...next]);
  }

  function isInherited(key: string) {
    return (impliedBy.get(key) || []).some((parentKey) => permissions.includes(parentKey));
  }

  return <div className="permission-layout">
    <section className="permission-section">
      <header className="permission-section__header"><h4>资源库</h4></header>
      <div className="permission-matrix-scroll">
        <table className="permission-matrix">
          <thead><tr><th scope="col">资源库</th>{libraryColumns.map(({ action, label }) => {
            const keys = LIBRARY_MODULES.map(([module]) => `${module}.${action}`).filter((key) => permissionsByKey.has(key));
            const selectedCount = keys.filter((key) => permissions.includes(key)).length;
            return <th key={action} scope="col"><label className="permission-column-toggle">
              <PermissionCheckbox checked={keys.length > 0 && selectedCount === keys.length} indeterminate={selectedCount > 0 && selectedCount < keys.length} disabled={disabled} label={`切换三个资源库的${label}权限`} onChange={(checked) => setPermissionKeys(keys, checked)} />
              <span>{label}</span>
            </label></th>;
          })}</tr></thead>
          <tbody>{LIBRARY_MODULES.map(([module, moduleLabel]) => <tr key={module}><th scope="row">{moduleLabel}</th>{libraryColumns.map(({ action, label }) => {
            const key = `${module}.${action}`;
             return <td key={action}>{permissionsByKey.has(key) ? <PermissionCheckbox checked={permissions.includes(key)} disabled={disabled || isInherited(key)} label={`${moduleLabel}：${label}${isInherited(key) ? "（由更高权限继承）" : ""}`} onChange={(checked) => setPermissionKeys([key], checked)} /> : null}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="permission-section">
      <header className="permission-section__header"><h4>无限画布</h4></header>
      <div className="permission-list">{canvasPermissions.map((permission) => <label className="check-option" key={permission.key}>
         <PermissionCheckbox checked={permissions.includes(permission.key)} disabled={disabled || isInherited(permission.key)} label={`无限画布：${permission.label}${isInherited(permission.key) ? "（由更高权限继承）" : ""}`} onChange={(checked) => setPermissionKeys([permission.key], checked)} />
        <span>{permission.label}</span>
      </label>)}</div>
    </section>
  </div>;
}
