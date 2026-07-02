import { detailList, section } from "../components/status-card.js";
import { metricGrid } from "../components/metric-grid.js";
import { formatBytes, formatDateTime, formatDuration } from "../state.js";

export function renderDashboard(data) {
  const server = data.status.server;
  const storage = data.storage.storage;
  const summary = data.summary.summary;
  const environment = data.environment.environment;

  return [
    section("服务状态", "当前 Forart server 运行信息。", detailList([
      { label: "监听 Host", value: server.host },
      { label: "监听端口", value: String(server.port) },
      { label: "启动时间", value: formatDateTime(server.startedAt) },
      { label: "运行时长", value: formatDuration(server.uptimeSeconds) },
      { label: "Node 版本", value: server.nodeVersion },
    ]), `<button id="refresh" class="refresh-button" type="button">刷新</button>`),
    section("资源统计", "只读统计，不执行任何修改操作。", metricGrid([
      { label: "模特项目", value: summary.modelProjects },
      { label: "模特", value: summary.models },
      { label: "穿搭项目", value: summary.outfitProjects },
      { label: "穿搭", value: summary.outfits },
      { label: "动作项目", value: summary.actionProjects },
      { label: "动作", value: summary.actions },
      { label: "资源文件", value: summary.assets },
    ])),
    section("存储路径", "当前服务端使用的完整存储位置。", detailList([
      { label: "数据目录", value: storage.dataDir },
      { label: "存储根目录", value: storage.storageRoot },
      { label: "数据库目录", value: storage.databaseDir },
      { label: "数据库文件", value: storage.databasePath },
      { label: "数据库状态", value: storage.databaseExists ? "存在" : "不存在" },
      { label: "数据库大小", value: formatBytes(storage.databaseSizeBytes) },
      { label: "更新时间", value: formatDateTime(storage.databaseModifiedAt) },
    ])),
    section("运行环境", "服务进程和部署相关信息。", detailList([
      { label: "NODE_ENV", value: environment.nodeEnv || "-" },
      { label: "平台", value: `${environment.platform} ${environment.arch}` },
      { label: "进程 ID", value: String(environment.pid) },
      { label: "语言", value: environment.language },
    ])),
  ].join("");
}
