import { useCreate, useList, useUpdate } from "@refinedev/core";
import { Check, KeyRound, Plus, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api";
import { Modal } from "../components/Modal";
import { formatDateTime } from "../format";
import type { PageHeaderSetter } from "../pageHeader";
import type { AdminUser, PermissionRole } from "../types";

function lastLoginLabel(value: string | null) {
  return value ? `最后登录 ${formatDateTime(value)}` : "从未登录";
}

export function UsersPage({ setPageHeader }: { setPageHeader: PageHeaderSetter }) {
  const usersQuery = useList<AdminUser>({ resource: "users" });
  const createUser = useCreate<AdminUser, any, { username: string; password: string; roleId: string | null }>();
  const updateUser = useUpdate<AdminUser, any, { roleId: string | null }>();
  const users = usersQuery.result.data;
  const [roles, setRoles] = useState<PermissionRole[]>([]);
  const [roleFilter, setRoleFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadAuthorizationOptions() {
    const rolePayload = await apiRequest<{ roles: PermissionRole[] }>("/api/admin/roles");
    setRoles(rolePayload.roles);
  }

  useEffect(() => {
    void loadAuthorizationOptions().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, []);

  const filteredUsers = useMemo(() => users.filter((user) => {
    if (roleFilter === "all") return true;
    if (roleFilter === "admin") return user.role === "admin";
    return user.role !== "admin" && user.roleId === roleFilter;
  }), [roleFilter, users]);

  const headerConfig = useMemo(() => ({
    count: `${filteredUsers.length} / ${users.length}`,
    actions: <div className="users-toolbar">
      <label className="inline-select"><span>用户组</span><select aria-label="按用户组筛选" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
        <option value="all">全部用户</option>
        <option value="admin">管理员</option>
        {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select></label>
      <button className="button button--primary" onClick={() => setCreateOpen(true)} type="button"><Plus size={15} />新增用户</button>
    </div>,
  }), [filteredUsers.length, roleFilter, roles, users.length]);

  useEffect(() => {
    setPageHeader(headerConfig);
    return () => setPageHeader(null);
  }, [headerConfig, setPageHeader]);

  function roleName(user: AdminUser) {
    if (user.role === "admin") return "管理员";
    return roles.find((role) => role.id === user.roleId)?.name || "访客";
  }

  async function changeUserRole(user: AdminUser, roleId: string) {
    if (user.role === "admin" || roleId === user.roleId) return;
    setUpdatingUserId(user.id);
    setError("");
    try {
      await updateUser.mutateAsync({ resource: "users", id: user.id, values: { roleId: roleId || null } });
      setNotice(`${user.username} 的用户组已更新`);
      await Promise.all([usersQuery.query.refetch(), loadAuthorizationOptions()]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setUpdatingUserId("");
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const roleId = String(form.get("roleId") || roles.find((role) => role.isDefault)?.id || "");
    try {
      await createUser.mutateAsync({ resource: "users", values: {
        username: String(form.get("username") || ""),
        password: String(form.get("password") || ""),
        roleId: roleId || null,
      } });
      setCreateOpen(false);
      setRoleFilter("all");
      setNotice("用户已创建");
      await Promise.all([usersQuery.query.refetch(), loadAuthorizationOptions()]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function submitDelete() {
    if (!deleteUser) return;
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(deleteUser.id)}`, { method: "DELETE" });
      setDeleteUser(null);
      setNotice("成员已删除");
      await Promise.all([usersQuery.query.refetch(), loadAuthorizationOptions()]);
    } catch (nextError) {
      setDeleteUser(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordUser) return;
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(passwordUser.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: String(form.get("password") || "") }),
      });
      setPasswordUser(null);
      setNotice("密码已重置，现有会话已退出");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return <div className="management-page">
      {notice ? <div className="inline-notice"><Check size={14} />{notice}</div> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {usersQuery.query.isLoading ? <div className="loading-state">正在读取用户...</div> : filteredUsers.length ? <div className="user-card-grid">
        {filteredUsers.map((user) => <article className="user-card" key={user.id}>
          <header className="user-card__header">
            <span className="user-card__avatar"><UserRound size={17} /></span>
            <span><strong>{user.username}</strong><small>{lastLoginLabel(user.lastLoginAt)}</small></span>
            <i>{roleName(user)}</i>
          </header>
          <label className="field user-card__role" onClick={(event) => event.stopPropagation()}><span>用户组</span><select
            disabled={user.role === "admin" || updatingUserId === user.id}
            value={user.role === "admin" ? "admin" : user.roleId || ""}
            onChange={(event) => void changeUserRole(user, event.target.value)}
          >
            {user.role === "admin" ? <option value="admin">管理员</option> : roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select></label>
          <footer className="user-card__actions">
            <button className="button button--ghost" onClick={(event) => { event.stopPropagation(); setPasswordUser(user); }} type="button"><KeyRound size={14} />重置密码</button>
            {user.role !== "admin" ? <button className="button button--ghost button--danger" onClick={(event) => { event.stopPropagation(); setDeleteUser(user); }} type="button"><Trash2 size={14} />删除</button> : null}
          </footer>
        </article>)}
      </div> : <div className="empty-state">当前用户组没有成员</div>}

    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新增用户"><form className="form-stack" onSubmit={submitCreate}><label className="field"><span>账号</span><input autoComplete="off" minLength={2} name="username" required /></label><label className="field"><span>初始密码</span><input autoComplete="new-password" minLength={8} name="password" required type="password" /></label><label className="field"><span>用户组</span><select defaultValue={roles.find((role) => role.isDefault)?.id} name="roleId">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><div className="modal-form-actions"><button className="button button--outline" onClick={() => setCreateOpen(false)} type="button">取消</button><button className="button button--primary" disabled={createUser.mutation.isPending} type="submit">创建</button></div></form></Modal>
    <Modal open={Boolean(passwordUser)} onClose={() => setPasswordUser(null)} title={`重置 ${passwordUser?.username || "用户"} 的密码`}><form className="form-stack" onSubmit={submitPassword}><label className="field"><span>新密码</span><input autoComplete="new-password" minLength={8} name="password" required type="password" /></label><div className="modal-form-actions"><button className="button button--outline" onClick={() => setPasswordUser(null)} type="button">取消</button><button className="button button--primary" type="submit">确认</button></div></form></Modal>
    <Modal open={Boolean(deleteUser)} onClose={() => setDeleteUser(null)} title="删除成员"><div className="confirm-copy"><ShieldAlert size={28} /><p>确定删除成员“{deleteUser?.username}”吗？该成员的登录会话和角色关系也会被删除。</p></div><div className="modal-form-actions"><button className="button button--outline" onClick={() => setDeleteUser(null)} type="button">取消</button><button className="button button--danger" onClick={() => void submitDelete()} type="button">确认删除</button></div></Modal>
  </div>;
}
