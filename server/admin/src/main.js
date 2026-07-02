import { loadAdminData } from "./api.js";
import { renderDashboard } from "./views/dashboard.js";

const app = document.querySelector("#app");
const health = document.querySelector("#server-health");

async function render() {
  health.dataset.tone = "busy";
  health.textContent = "加载中";
  try {
    const data = await loadAdminData();
    app.innerHTML = renderDashboard(data);
    health.dataset.tone = "ready";
    health.textContent = `在线 · ${data.status.server.port}`;
    document.querySelector("#refresh")?.addEventListener("click", () => {
      void render();
    });
  } catch (error) {
    health.dataset.tone = "error";
    health.textContent = "读取失败";
    app.innerHTML = `<div class="error-panel">${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

void render();
