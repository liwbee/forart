import { Check, Plus, Save, Settings, ShieldAlert, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api";
import { Modal } from "../components/Modal";
import { PermissionMatrix } from "../components/PermissionMatrix";
import type { PageHeaderSetter } from "../pageHeader";
import type { AdminUser, PermissionDefinition, PermissionRole } from "../types";

export function RolesPage({ setPageHeader }: { setPageHeader: PageHeaderSetter }) {
  const [roles, setRoles] = useState<PermissionRole[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionDefinition[]>([]);
  const [editingRole, setEditingRole] = useState<PermissionRole | null>(null);
  const [memberRole, setMemberRole] = useState<PermissionRole | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRole, setDeleteRole] = useState<PermissionRole | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [rolePayload, userPayload, catalogPayload] = await Promise.all([
      apiRequest<{ roles: PermissionRole[] }>("/api/admin/roles"),
      apiRequest<{ users: AdminUser[] }>("/api/admin/users"),
      apiRequest<{ permissions: PermissionDefinition[] }>("/api/admin/permission-catalog"),
    ]);
    setRoles(rolePayload.roles);
    setUsers(userPayload.users);
    setCatalog(catalogPayload.permissions);
  }

  useEffect(() => {
    void load().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, []);

  const headerConfig = useMemo(() => ({
    count: roles.length,
    actions: <button className="button button--primary" onClick={() => setCreateOpen(true)} type="button"><Plus size={15} />新增角色</button>,
  }), [roles.length]);

  useEffect(() => {
    setPageHeader(headerConfig);
    return () => setPageHeader(null);
  }, [headerConfig, setPageHeader]);

  function openSettings(role: PermissionRole) {
    setEditingRole(role);
    setDraftName(role.name);
    setDraftPermissions(role.permissions.filter((key) => !key.endsWith(".view")));
    setNotice("");
    setError("");
  }

  function openMembers(role: PermissionRole) {
    setMemberRole(role);
    setDraftMemberIds(role.memberIds);
    setNotice("");
    setError("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await apiRequest<{ role: PermissionRole }>("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name") }),
      });
      setCreateOpen(false);
      setNotice("角色已创建");
      await load();
      openSettings(payload.role);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRole) return;
    try {
      const rolePath = `/api/admin/roles/${encodeURIComponent(editingRole.id)}`;
      await apiRequest(rolePath, {
        method: "PATCH",
        body: JSON.stringify({
          ...(editingRole.isDefault ? {} : { name: draftName }),
          permissions: draftPermissions,
        }),
      });
      setEditingRole(null);
      setNotice("角色设置已保存");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function saveMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberRole || memberRole.isDefault) return;
    try {
      await apiRequest(`/api/admin/roles/${encodeURIComponent(memberRole.id)}/members`, {
        method: "PUT",
        body: JSON.stringify({ memberIds: draftMemberIds }),
      });
      setMemberRole(null);
      setNotice("角色成员已保存");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function remove() {
    if (!deleteRole) return;
    try {
      await apiRequest(`/api/admin/roles/${encodeURIComponent(deleteRole.id)}`, { method: "DELETE" });
      setDeleteRole(null);
      setNotice("角色已删除，原成员已转为访客");
      await load();
    } catch (nextError) {
      setDeleteRole(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return <div className="management-page">
    {notice ? <div className="inline-notice"><Check size={14} />{notice}</div> : null}
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    <div className="role-card-grid">
      {roles.map((role) => {
        const operationCount = role.permissions.filter((key) => !key.endsWith(".view")).length;
        return <article className="role-card" key={role.id}>
          <header className="role-card__header">
            <span className="role-card__icon"><ShieldCheck size={18} /></span>
            <span><strong>{role.name}</strong><small>{role.isDefault ? "新用户的默认角色" : "自定义角色"}</small></span>
            <button aria-label={`设置 ${role.name}`} className="icon-button" onClick={() => openSettings(role)} title="设置角色" type="button"><Settings size={15} /></button>
          </header>
          <dl className="role-card__stats">
            <div><dt><UsersRound size={13} />成员</dt><dd>{role.memberIds.length}</dd></div>
            <div><dt><ShieldCheck size={13} />操作权限</dt><dd>{operationCount}</dd></div>
          </dl>
          <footer className="role-card__actions">
            <button className="button button--ghost" onClick={() => openMembers(role)} type="button"><UsersRound size={14} />成员管理</button>
            {!role.isDefault ? <button className="button button--ghost button--danger" onClick={() => setDeleteRole(role)} type="button"><Trash2 size={14} />删除</button> : null}
          </footer>
        </article>;
      })}
    </div>

    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新增角色"><form className="form-stack" onSubmit={create}><label className="field"><span>名称</span><input maxLength={96} name="name" required /></label><div className="modal-form-actions"><button className="button button--outline" onClick={() => setCreateOpen(false)} type="button">取消</button><button className="button button--primary" type="submit">创建</button></div></form></Modal>

    <Modal open={Boolean(editingRole)} onClose={() => setEditingRole(null)} size="wide" title={`设置 ${editingRole?.name || "角色"}`}>
      {editingRole ? <form className="role-settings-form" onSubmit={saveSettings}>
        <label className="field role-settings-name"><span>角色名称</span><input disabled={editingRole.isDefault} maxLength={96} required value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
        <div className="permission-caption"><strong>角色权限</strong><span>所有成员默认可读，这里设置编辑、删除和排序等操作权限。</span></div>
        <PermissionMatrix catalog={catalog} permissions={draftPermissions} onChange={setDraftPermissions} />
        <div className="modal-form-actions"><button className="button button--outline" onClick={() => setEditingRole(null)} type="button">取消</button><button className="button button--primary" type="submit"><Save size={14} />保存</button></div>
      </form> : null}
    </Modal>

    <Modal open={Boolean(memberRole)} onClose={() => setMemberRole(null)} size="wide" title={`${memberRole?.name || "角色"} · 成员管理`}>
      {memberRole ? <form className="role-members-form" onSubmit={saveMembers}>
        <div className="permission-caption permission-caption--top"><strong>角色成员</strong><span>{draftMemberIds.length} 人{memberRole.isDefault ? " · 访客归属请在用户管理中调整" : ""}</span></div>
        <div className="permission-section"><div className="permission-list permission-list--roles">
          {users.filter((user) => user.role !== "admin").map((user) => <label className="check-option" key={user.id}><input checked={draftMemberIds.includes(user.id)} disabled={memberRole.isDefault} type="checkbox" onChange={(event) => setDraftMemberIds(event.target.checked ? [...draftMemberIds, user.id] : draftMemberIds.filter((id) => id !== user.id))} /><span>{user.username}</span></label>)}
          {!users.some((user) => user.role !== "admin") ? <span className="empty-inline">暂无可分配成员</span> : null}
        </div></div>
        <div className="modal-form-actions"><button className="button button--outline" onClick={() => setMemberRole(null)} type="button">{memberRole.isDefault ? "关闭" : "取消"}</button>{!memberRole.isDefault ? <button className="button button--primary" type="submit"><Save size={14} />保存</button> : null}</div>
      </form> : null}
    </Modal>

    <Modal open={Boolean(deleteRole)} onClose={() => setDeleteRole(null)} title="删除角色"><div className="confirm-copy"><ShieldAlert size={28} /><p>确定删除角色“{deleteRole?.name}”吗？角色成员不会被删除，而是自动转为访客。</p></div><div className="modal-form-actions"><button className="button button--outline" onClick={() => setDeleteRole(null)} type="button">取消</button><button className="button button--danger" onClick={() => void remove()} type="button">确认删除</button></div></Modal>
  </div>;
}
