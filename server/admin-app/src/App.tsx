import { Refine, useCustom, useGetIdentity, useIsAuthenticated, useLogout } from "@refinedev/core";
import { ChevronDown, ChevronRight, Database, LayoutDashboard, LogOut, ShieldCheck, UserRoundCog, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { DashboardPage } from "./pages/DashboardPage";
import { RolesPage } from "./pages/RolesPage";
import { UsersPage } from "./pages/UsersPage";
import { authProvider, dataProvider } from "./providers";
import type { PageHeaderConfig } from "./pageHeader";
import type { AdminIdentity, ServerStatusPayload } from "./types";

type View = "dashboard" | "users" | "roles";

const VIEW_META: Record<View, { title: string; description: string }> = {
  dashboard: { title: "概览", description: "查看服务运行状态与资源数据" },
  users: { title: "用户管理", description: "管理成员账号和所属角色" },
  roles: { title: "角色管理", description: "集中维护角色成员与权限" },
};

function AdminShell() {
  const authentication = useIsAuthenticated();
  const identity = useGetIdentity<AdminIdentity>();
  const logout = useLogout();
  const status = useCustom<ServerStatusPayload>({
    url: "/api/admin/status",
    method: "get",
    queryOptions: { enabled: authentication.data?.authenticated === true, refetchInterval: 30000 },
  });
  const [view, setView] = useState<View>("dashboard");
  const [permissionsOpen, setPermissionsOpen] = useState(true);
  const [pageHeader, setPageHeader] = useState<PageHeaderConfig | null>(null);

  if (authentication.isLoading) return <div className="fullscreen-state">正在验证会话...</div>;
  if (!authentication.data?.authenticated) return <AuthScreen bootstrap={false} onBootstrap={() => undefined} />;

  const server = status.result.data?.server;
  const meta = VIEW_META[view];
  const headerIcon = view === "roles" ? <UserRoundCog size={17} /> : view === "users" ? <UsersRound size={17} /> : <LayoutDashboard size={17} />;
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="sidebar-brand"><span className="brand-mark" aria-hidden="true" /><div><strong>Forart</strong><span>Server Admin</span></div></div>
      <nav className="primary-nav" aria-label="后台导航">
        <button className={view === "dashboard" ? "is-active" : ""} onClick={() => setView("dashboard")} type="button"><LayoutDashboard size={15} />概览</button>
        <button aria-expanded={permissionsOpen} className={`nav-group${view === "roles" || view === "users" ? " has-active-child" : ""}`} onClick={() => setPermissionsOpen((open) => !open)} type="button"><ShieldCheck size={15} />权限管理<span className="nav-group__chevron">{permissionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
        {permissionsOpen ? <div className="nav-children">
          <button className={`nav-child${view === "roles" ? " is-active" : ""}`} onClick={() => setView("roles")} type="button"><UserRoundCog size={15} />角色管理</button>
          <button className={`nav-child${view === "users" ? " is-active" : ""}`} onClick={() => setView("users")} type="button"><UsersRound size={15} />用户管理</button>
        </div> : null}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-status" data-ready={Boolean(server)}><Database size={14} /><span><strong>{server ? "服务正常" : "正在连接"}</strong><small>{server ? `端口 ${server.port}` : "请稍候"}</small></span></div>
        <div className="sidebar-account"><span className="account-avatar">{(identity.data?.username || "A").slice(0, 1).toUpperCase()}</span><span><strong>{identity.data?.username || "管理员"}</strong><small>管理员</small></span><button aria-label="退出登录" className="icon-button" onClick={() => logout.mutate()} title="退出登录" type="button"><LogOut size={15} /></button></div>
      </div>
    </aside>
    <div className="admin-main">
      <header className="content-header">
        <div className="content-header__identity">
          <span className="content-header__icon" aria-hidden="true">{headerIcon}</span>
          <div><div className="content-header__heading"><h1>{meta.title}</h1>{pageHeader?.count !== undefined ? <span className="count-badge">{pageHeader.count}</span> : null}</div><p>{meta.description}</p></div>
        </div>
        {pageHeader?.actions ? <div className="content-header__actions">{pageHeader.actions}</div> : null}
      </header>
      <main className="admin-content">{view === "users" ? <UsersPage setPageHeader={setPageHeader} /> : view === "roles" ? <RolesPage setPageHeader={setPageHeader} /> : <DashboardPage />}</main>
    </div>
  </div>;
}

function BootstrapGate() {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiRequest<{ initialized: boolean }>("/api/admin/bootstrap-status")
      .then((payload) => setInitialized(payload.initialized))
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, []);

  if (error) return <div className="fullscreen-state fullscreen-state--error">{error}</div>;
  if (initialized === null) return <div className="fullscreen-state">正在连接服务端...</div>;
  if (!initialized) return <AuthScreen bootstrap onBootstrap={() => setInitialized(true)} />;
  return <AdminShell />;
}

export function App() {
  return <Refine
    authProvider={authProvider}
    dataProvider={dataProvider}
    options={{ disableTelemetry: true }}
    resources={[{ name: "users" }]}
  >
    <BootstrapGate />
  </Refine>;
}
