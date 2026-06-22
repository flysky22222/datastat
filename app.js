(() => {
  "use strict";
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATUS_LABEL = { open: "待处理", merged: "已合入", closed: "已关闭" };
  const ICONS = {
    list: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01"/></svg>',
    check: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 4L6 12 3 9"/></svg>',
    clock: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>',
    user: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c.8-3 3-4 5.5-4s4.7 1 5.5 4"/></svg>',
    tag: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 2h5l7 7-5 5-7-7V2z"/><circle cx="5" cy="5" r="1"/></svg>',
  };
  const ico = k => ICONS[k] || "";

  const state = { data: null, records: [], status: "all", assignee: "all", dateField: "createdAt", from: "", to: "", query: "" };

  fetch("./data.json?t=" + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { state.data = d; state.records = d.records || []; init(); })
    .catch(e => { $("#reqList").innerHTML = `<div class="empty">数据加载失败：${esc(e.message || e)}</div>`; });

  function init() {
    const d = state.data;
    $("#genAt").textContent = d.generatedAt ? `数据生成于 ${d.generatedAt}` : "";

    // 负责人下拉（含未分配）
    const asgCount = {};
    let unassigned = 0;
    state.records.forEach(r => {
      if (!r.assignees || !r.assignees.length) unassigned++;
      (r.assignees || []).forEach(a => { asgCount[a] = (asgCount[a] || 0) + 1; });
    });
    const asgSel = $("#asgSel");
    const opts = [`<option value="all">全部（${state.records.length}）</option>`];
    Object.keys(asgCount).sort((a, b) => asgCount[b] - asgCount[a] || a.localeCompare(b))
      .forEach(a => opts.push(`<option value="${esc(a)}">${esc(a)}（${asgCount[a]}）</option>`));
    if (unassigned) opts.push(`<option value="__none__">未分配（${unassigned}）</option>`);
    asgSel.innerHTML = opts.join("");

    // 时间范围默认值（数据实际跨度）
    const dates = state.records.map(r => r.createdAt).filter(Boolean).sort();
    if (dates.length) {
      $("#dateFrom").min = $("#dateTo").min = dates[0];
      $("#dateFrom").max = $("#dateTo").max = dates[dates.length - 1];
    }

    // 事件绑定
    $("#statusChips").addEventListener("click", e => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.status = b.dataset.status; setActive("#statusChips .chip", b); render();
    });
    asgSel.addEventListener("change", () => { state.assignee = asgSel.value; render(); });
    $("#dateField").addEventListener("change", () => { state.dateField = $("#dateField").value; render(); });
    $("#dateFrom").addEventListener("change", () => { state.from = $("#dateFrom").value; render(); });
    $("#dateTo").addEventListener("change", () => { state.to = $("#dateTo").value; render(); });
    $("#resetBtn").addEventListener("click", () => {
      state.status = "all"; state.assignee = "all"; state.dateField = "createdAt";
      state.from = ""; state.to = ""; state.query = "";
      $("#dateFrom").value = ""; $("#dateTo").value = ""; $("#search").value = "";
      $("#dateField").value = "createdAt"; asgSel.value = "all";
      setActive("#statusChips .chip", $('#statusChips .chip[data-status="all"]'));
      render();
    });
    const s = $("#search");
    s.addEventListener("input", () => { state.query = s.value.trim().toLowerCase(); render(); });

    render();
  }

  function setActive(sel, btn) { document.querySelectorAll(sel).forEach(b => b.classList.toggle("active", b === btn)); }

  function selectRecords() {
    let out = state.records.slice();
    if (state.status !== "all") out = out.filter(r => r.status === state.status);
    if (state.assignee === "__none__") out = out.filter(r => !r.assignees || !r.assignees.length);
    else if (state.assignee !== "all") out = out.filter(r => (r.assignees || []).includes(state.assignee));
    if (state.from || state.to) {
      out = out.filter(r => {
        const v = r[state.dateField];
        if (!v) return false;
        if (state.from && v < state.from) return false;
        if (state.to && v > state.to) return false;
        return true;
      });
    }
    if (state.query) {
      const q = state.query;
      out = out.filter(r => r.title.toLowerCase().includes(q) || String(r.number).includes(q)
        || (r.assignees || []).some(a => a.toLowerCase().includes(q)));
    }
    return out;
  }

  function render() {
    const recs = selectRecords();
    renderStats(recs);
    renderTable(recs);
    $("#empty").hidden = recs.length > 0;
  }

  function renderStats(recs) {
    const by = k => recs.filter(r => r.status === k).length;
    const typ = t => recs.filter(r => r.type === t).length;
    const asgSet = new Set();
    recs.forEach(r => (r.assignees || []).forEach(a => asgSet.add(a)));
    const unassigned = recs.filter(r => !r.assignees || !r.assignees.length).length;
    const done = by("merged"), total = recs.length;
    const doneRate = total ? Math.round(done / total * 100) : 0;
    const card = (icon, v, k, sub) => `<div class="stat"><div class="stat-h">${ico(icon)}<span class="k">${k}</span></div><div class="v">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    $("#stats").innerHTML =
      card("list", total, "需求总数", `<span class="s-succ">需求 ${typ("需求")}</span><span class="s-fail">缺陷 ${typ("缺陷")}</span><span>任务 ${typ("任务")}</span>`) +
      card("clock", by("open"), "待处理 (open)", `进行中 / 未关闭`) +
      card("check", `${done}`, "已合入", `完成率 ${doneRate}%`) +
      card("tag", by("closed"), "已关闭", `不做 / 已取消`) +
      card("user", asgSet.size, "涉及负责人", `未分配 ${unassigned} 条`);
  }

  function renderTable(recs) {
    const el = $("#reqList");
    if (!recs.length) { el.innerHTML = ""; return; }
    const st = s => `<span class="badge ${s}">${STATUS_LABEL[s] || s}</span>`;
    const asgCell = r => {
      const a = r.assignees || [];
      if (!a.length) return `<span class="none">未分配</span>`;
      return a.map(login => `<a class="av" href="https://github.com/${esc(login)}" target="_blank" rel="noopener"><img src="https://avatars.githubusercontent.com/${esc(login)}?s=36" alt="" loading="lazy" />${esc(login)}</a>`).join("<br>");
    };
    const dateCell = r => {
      const created = r.createdAt || "—";
      const tail = r.status === "open"
        ? `更新 ${r.updatedAt || "—"}`
        : `关闭 ${r.closedAt || r.updatedAt || "—"}`;
      return `${created}<span class="req-labels">${tail}</span>`;
    };
    const rows = recs.map(r => `<tr onclick="window.open('${esc(r.url)}','_blank')">
      <td class="req-num">#${r.number}</td>
      <td><span class="tag t-${esc(r.type)}">${esc(r.type)}</span></td>
      <td class="req-title"><a href="${esc(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(r.title)}</a>
        ${r.labels && r.labels.length ? `<span class="req-labels">${r.labels.map(esc).join(" · ")}</span>` : ""}</td>
      <td>${st(r.status)}</td>
      <td class="req-asg">${asgCell(r)}</td>
      <td class="req-date">${dateCell(r)}</td>
    </tr>`).join("");
    el.innerHTML = `<div class="req-head"><h2>${ico("list")} 数据中台需求列表</h2>
      <span class="meta">共 ${recs.length} 条 · 待处理 ${recs.filter(r => r.status === "open").length} · 已合入 ${recs.filter(r => r.status === "merged").length} · 已关闭 ${recs.filter(r => r.status === "closed").length}</span></div>
      <div class="tbl-wrap"><table><thead><tr>
        <th>编号</th><th>类型</th><th>需求标题</th><th>状态</th><th>负责人</th><th>时间</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
})();
