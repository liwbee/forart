import { escapeHtml } from "../dom.js";

export function section(title, description, body, action = "") {
  return `
    <section class="section">
      <div class="section__head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
        ${action}
      </div>
      <div class="section__body">${body}</div>
    </section>
  `;
}

export function detailList(items) {
  return `
    <dl class="detail-list">
      ${items.map((item) => `
        <dt>${escapeHtml(item.label)}</dt>
        <dd>${escapeHtml(item.value || "-")}</dd>
      `).join("")}
    </dl>
  `;
}
