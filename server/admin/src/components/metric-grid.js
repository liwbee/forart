import { escapeHtml } from "../dom.js";

export function metricGrid(items) {
  return `
    <div class="metric-grid">
      ${items.map((item) => `
        <div class="metric">
          <div class="metric__label">${escapeHtml(item.label)}</div>
          <div class="metric__value">${escapeHtml(item.value)}</div>
        </div>
      `).join("")}
    </div>
  `;
}
