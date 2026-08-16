import { useCustom } from "@refinedev/core";
import { PanelsTopLeft, RefreshCw, Server, Waypoints } from "lucide-react";
import { formatDateTime, formatDuration } from "../format";
import type { LibrarySummaryPayload, ServerStatusPayload, StoragePayload } from "../types";

function DetailList({ items }: { items: Array<{ label: string; value: string }> }) {
  return <dl className="detail-list">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

function StatCard({ title, items }: { title: string; items: Array<{ label: string; value: number }> }) {
  return <article className="stat-card">
    <header>{title}</header>
    <dl>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
  </article>;
}

export function DashboardPage() {
  const status = useCustom<ServerStatusPayload>({ url: "/api/admin/status", method: "get" });
  const storage = useCustom<StoragePayload>({ url: "/api/admin/storage", method: "get" });
  const summary = useCustom<LibrarySummaryPayload>({ url: "/api/admin/library-summary", method: "get" });
  const queries = [status.query, storage.query, summary.query];
  const loading = queries.some((query) => query.isLoading);
  const error = queries.find((query) => query.error)?.error;

  if (loading) return <div className="loading-state">正在读取服务状态...</div>;
  if (error) return <div className="inline-error">{error.message}</div>;

  const serverData = status.result.data?.server;
  const storageData = storage.result.data?.storage;
  const summaryData = summary.result.data?.summary;
  if (!serverData || !storageData || !summaryData) return <div className="inline-error">服务状态数据不完整</div>;

  const refresh = () => void Promise.all(queries.map((query) => query.refetch()));
  const databaseName = storageData.databaseDriver === "postgres" ? "PostgreSQL" : "SQLite";

  return <div className="page-stack">
    <section className="page-section">
      <header className="section-heading">
        <div><Server size={17} /><h2>服务状态</h2></div>
        <button className="button button--outline" disabled={queries.some((query) => query.isFetching)} onClick={refresh} type="button">
          <RefreshCw size={14} />刷新
        </button>
      </header>
      <DetailList items={[
        { label: "数据库", value: `${databaseName} · ${storageData.databaseReady ? "已连接" : "未就绪"}` },
        { label: "运行时长", value: formatDuration(serverData.uptimeSeconds) },
        { label: "启动时间", value: formatDateTime(serverData.startedAt) },
      ]} />
    </section>

    <section className="page-section">
      <header className="section-heading"><div><Waypoints size={17} /><h2>资源库统计</h2></div></header>
      <div className="stat-card-grid stat-card-grid--libraries">
        <StatCard title="模特库" items={[{ label: "项目", value: summaryData.modelProjects }, { label: "模特", value: summaryData.models }]} />
        <StatCard title="搭配库" items={[{ label: "项目", value: summaryData.outfitProjects }, { label: "搭配", value: summaryData.outfits }]} />
        <StatCard title="动作库" items={[{ label: "项目", value: summaryData.actionProjects }, { label: "动作", value: summaryData.actions }]} />
        <StatCard title="资源文件" items={[{ label: "文件", value: summaryData.assets }]} />
      </div>
    </section>

    <section className="page-section">
      <header className="section-heading"><div><PanelsTopLeft size={17} /><h2>画布统计</h2></div></header>
      <div className="stat-card-grid stat-card-grid--canvas">
        <StatCard title="共享画布" items={[{ label: "项目", value: summaryData.canvasProjects }, { label: "画布", value: summaryData.canvases }]} />
      </div>
    </section>
  </div>;
}
