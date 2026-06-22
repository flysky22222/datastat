(() => {
  "use strict";
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATUS_LABEL = { open: "待处理", merged: "已合入", closed: "已关闭" };
  const PRI_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, "": 9 };

  const ICONS = {
    list: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01"/></svg>',
    check: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 4L6 12 3 9"/></svg>',
    clock: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>',
    user: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c.8-3 3-4 5.5-4s4.7 1 5.5 4"/></svg>',
    tag: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 2h5l7 7-5 5-7-7V2z"/><circle cx="5" cy="5" r="1"/></svg>',
    flag: '<svg class="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2v12M3 3h8l-1.5 2.5L11 8H3"/></svg>',
  };
  const ico = k => ICONS[k] || "";

  const state = {
    data: null, records: [],
    status: "all", assignee: "all", priFilter: "all",
    dateField: "createdAt", from: "", to: "", query: "",
  };

  fetch("./data.json?t=" + Date.now())
    .then(r => { if (!r.ok) throw new Error("data.json " + r.status); return r.json(); })
    .then(d => { state.data = d; state.records = d.records || []; init(); })
    .catch(e => { $("#reqList").innerHTML = `<div class="empty">数据加载失败：${esc(e.message || e)}</div>`; });

  function init() {
    const d = state.data;
    $("#genAt").textContent = d.generatedAt ? `数据生成于 ${d.generatedAt}` : "";

    // 负责人下拉
    const asgCount = {}; let unassigned = 0;
    state.records.forEach(r => {
      if (!r.assignees || !r.assignees.length) unassigned++;
      (r.assignees || []).forEach(a => { asgCount[a] = (asgCount[a] || 0) + 1; });
    });
    const opts = [`<option value="all">全部（${state.records.length}）</option>`];
    Object.keys(asgCount).sort((a, b) => asgCount[b] - asgCount[a] || a.localeCompare(b))
      .forEach(a => opts.push(`<option value="${esc(a)}">${esc(a)}（${asgCount[a]}）</option>`));
    if (unassigned) opts.push(`<option value="__none__">未分配（${unassigned}）</option>`);
    $("#asgSel").innerHTML = opts.join("");

    // 时间范围默认跨度
    const dates = state.records.map(r => r.createdAt).filter(Boolean).sort();
    if (dates.length) {
      $("#dateFrom").min = $("#dateTo").min = dates[0];
      $("#dateFrom").max = $("#dateTo").max = dates[dates.length - 1];
    }

    $("#statusChips").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; state.status = b.dataset.status; setActive("#statusChips .chip", b); render(); });
    $("#priChips").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; state.priFilter = b.dataset.pri; setActive("#priChips .chip", b); render(); });
    $("#asgSel").addEventListener("change", () => { state.assignee = $("#asgSel").value; render(); });
    $("#dateField").addEventListener("change", () => { state.dateField = $("#dateField").value; render(); });
    $("#dateFrom").addEventListener("change", () => { state.from = $("#dateFrom").value; render(); });
    $("#dateTo").addEventListener("change", () => { state.to = $("#dateTo").value; render(); });
    $("#resetBtn").addEventListener("click", () => {
      state.status = "all"; state.assignee = "all"; state.priFilter = "all";
      state.dateField = "createdAt"; state.from = ""; state.to = ""; state.query = "";
      $("#dateFrom").value = ""; $("#dateTo").value = ""; $("#search").value = "";
      $("#dateField").value = "createdAt"; $("#asgSel").value = "all";
      setActive("#statusChips .chip", $('#statusChips .chip[data-status="all"]'));
      setActive("#priChips .chip", $('#priChips .chip[data-pri="all"]'));
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
    if (state.priFilter !== "all") {
      if (state.priFilter === "none") out = out.filter(r => !r.priority);
      else out = out.filter(r => r.priority === state.priFilter);
    }
    if (state.assignee === "__none__") out = out.filter(r => !r.assignees || !r.assignees.length);
    else if (state.assignee !== "all") out = out.filter(r => (r.assignees || []).includes(state.assignee));
    if (state.from || state.to) {
      out = out.filter(r => {
        const v = r[state.dateField]; if (!v) return false;
        if (state.from && v < state.from) return false;
        if (state.to && v > state.to) return false;
        return true;
      });
    }
    if (state.query) {
      const q = state.query;
      out = out.filter(r => r.title.toLowerCase().includes(q) || String(r.number).includes(q)
        || (r.assignees || []).some(a => a.toLowerCase().includes(q))
        || (r.author || "").toLowerCase().includes(q));
    }
    // 排序：优先级高→低（未定沉底），同级按创建时间倒序
    out.sort((a, b) => (PRI_RANK[a.priority || ""] - PRI_RANK[b.priority || ""]) || (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }

  function render() {
    const recs = selectRecords();
    renderPersonChart(recs);
    renderStats(recs);
    renderTable(recs);
    $("#empty").hidden = recs.length > 0;
  }

  // 顶部柱状图：每个人「已合入(完成)」的需求个数，一人一柱
  function renderPersonChart(recs) {
    const el = $("#byPerson");
    const done = recs.filter(r => r.status === "merged");
    const cnt = {};
    done.forEach(r => (r.assignees || []).forEach(a => { cnt[a] = (cnt[a] || 0) + 1; }));
    const people = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b));
    const head = `<div class="chart-card"><h3>${ico("check")} 各负责人完成需求数（已合入）<span class="hint">当前筛选下共完成 ${done.length} 条</span></h3>`;
    if (!people.length) { el.innerHTML = head + `<div class="empty mini">当前筛选下暂无已合入需求</div></div>`; return; }
    const max = Math.max.apply(null, people.map(p => cnt[p]));
    const bars = people.map(p => {
      const h = Math.round(cnt[p] / max * 100);
      return `<div class="vbar" title="${esc(p)}：完成 ${cnt[p]} 条">
        <span class="vbar-v">${cnt[p]}</span>
        <div class="vbar-track"><i style="height:${Math.max(h, 4)}%"></i></div>
        <span class="vbar-l"><img src="https://avatars.githubusercontent.com/${esc(p)}?s=32" alt="" loading="lazy" /><span>${esc(p)}</span></span>
      </div>`;
    }).join("");
    el.innerHTML = head + `<div class="vbars">${bars}</div></div>`;
  }

  function renderStats(recs) {
    const by = k => recs.filter(r => r.status === k).length;
    const typ = t => recs.filter(r => r.type === t).length;
    const asgSet = new Set(); recs.forEach(r => (r.assignees || []).forEach(a => asgSet.add(a)));
    const unassigned = recs.filter(r => !r.assignees || !r.assignees.length).length;
    const done = by("merged"), total = recs.length;
    const doneRate = total ? Math.round(done / total * 100) : 0;
    const prioritized = recs.filter(r => r.priority).length;
    const card = (icon, v, k, sub) => `<div class="stat"><div class="stat-h">${ico(icon)}<span class="k">${k}</span></div><div class="v">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    $("#stats").innerHTML =
      card("list", total, "需求总数", `<span class="s-succ">需求 ${typ("需求")}</span><span class="s-fail">缺陷 ${typ("缺陷")}</span><span>任务 ${typ("任务")}</span>`) +
      card("clock", by("open"), "待处理 (open)", `进行中 / 未关闭`) +
      card("check", `${done}`, "已合入", `完成率 ${doneRate}%`) +
      card("tag", by("closed"), "已关闭", `不做 / 已取消`) +
      card("flag", prioritized, "已定优先级", `共 ${total} 条`) +
      card("user", asgSet.size, "涉及负责人", `未分配 ${unassigned} 条`);
  }

  function renderTable(recs) {
    const el = $("#reqList");
    if (!recs.length) { el.innerHTML = ""; return; }
    const st = s => `<span class="badge ${s}">${STATUS_LABEL[s] || s}</span>`;
    const priBadge = p => p
      ? `<span class="pri-badge pri-${p}">${p}</span>`
      : `<span class="pri-badge pri-none">未定</span>`;
    const userLink = login => `<a class="av" href="https://github.com/${esc(login)}" target="_blank" rel="noopener"><img src="https://avatars.githubusercontent.com/${esc(login)}?s=36" alt="" loading="lazy" />${esc(login)}</a>`;
    const asgCell = r => {
      const a = r.assignees || [];
      if (!a.length) return `<span class="none">未分配</span>`;
      return a.map(userLink).join("<br>");
    };
    const authorCell = r => r.author ? userLink(r.author) : `<span class="none">—</span>`;
    const rows = recs.map(r => `<tr>
      <td class="req-num"><a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number}</a></td>
      <td class="req-pri">${priBadge(r.priority)}</td>
      <td><span class="tag t-${esc(r.type)}">${esc(r.type)}</span></td>
      <td class="req-title"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        ${r.labels && r.labels.length ? `<span class="req-labels">${r.labels.map(esc).join(" · ")}</span>` : ""}</td>
      <td>${st(r.status)}</td>
      <td class="req-asg">${authorCell(r)}</td>
      <td class="req-asg">${asgCell(r)}</td>
      <td class="req-date">${r.createdAt || "—"}</td>
      <td class="req-date req-plan">${r.plannedAt ? `<span class="plan-at">${r.plannedAt}</span>` : '<span class="none">—</span>'}</td>
      <td class="req-date req-done">${r.closedAt ? `<span class="done-at">${r.closedAt}</span>` : '<span class="none">—</span>'}</td>
    </tr>`).join("");
    el.innerHTML = `<div class="req-head"><h2>${ico("list")} 数据中台需求列表</h2>
      <span class="meta">共 ${recs.length} 条 · 待处理 ${recs.filter(r => r.status === "open").length} · 已合入 ${recs.filter(r => r.status === "merged").length} · 已关闭 ${recs.filter(r => r.status === "closed").length}</span></div>
      <div class="tbl-wrap"><table><thead><tr>
        <th>编号</th><th>优先级</th><th>类型</th><th>需求标题</th><th>状态</th><th>提出人</th><th>负责人</th><th>创建时间</th><th>计划完成时间</th><th>完成时间</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
})();
