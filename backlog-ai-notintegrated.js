(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const charts = {};
  const ec = id => charts[id] || (charts[id] = echarts.init(document.getElementById(id)));
  window.addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));
  const FIXCOLOR = { fix: "#3ba272", proc: "#e6a23c", out: "#909399" };
  let D;

  fetch("./backlog-ai-notintegrated.json?t=" + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { D = d; init(); })
    .catch(e => { const el = $("#err"); el.style.display = "block"; el.textContent = "数据加载失败:" + e; });

  function init() {
    renderKpis(); renderReason(); renderTypeScen(); renderSvc(); initTable();
    fetch("./backlog-ai-notintegrated-coverage.json?t=" + Date.now())
      .then(r => r.ok ? r.json() : null).then(c => { if (c) renderCoverage(c); }).catch(() => {});
    fetch("./backlog-ai-notintegrated-repos.json?t=" + Date.now())
      .then(r => r.ok ? r.json() : null).then(c => { if (c) renderRepos(c); }).catch(() => {});
  }
  function renderRepos(R) {
    const active = R.total - R.archived - R.fork;
    const kp = [
      ["opensourceways 全 org 仓", R.total, `公 ${R.public}/私 ${R.private}`],
      ["活跃仓(排归档/fork)", active, `归档 ${R.archived}`],
      ["🟢 接入 AI 的仓", R.covered_by_integrated, "属已跑过AI的服务"],
      ["🔴 未归属仓", R.unattr_active_n + R.unattr_infra_n, `业务 ${R.unattr_active_n}/基建 ${R.unattr_infra_n}`],
    ];
    $("#repo-kpis").innerHTML = kp.map(([k, v, x]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${x ? `<small>${x}</small>` : ""}</div></div>`).join("");
    const parts = [
      { name: "🟢 接入 AI", value: R.cat["接入AI"] || 0, c: "#3ba272" },
      { name: "🟡 已注册未接入", value: R.cat["已注册未接入"] || 0, c: "#e6a23c" },
      { name: "🔴 未归属·活跃业务", value: R.unattr_active_n, c: "#b03a3a" },
      { name: "⚪ 未归属·公共基建", value: R.unattr_infra_n, c: "#909399" },
    ];
    ec("c-repo").setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} 仓 ({d}%)" }, legend: { type: "scroll", bottom: 0 },
      series: [{ type: "pie", radius: ["40%", "68%"], center: ["50%", "44%"], label: { formatter: "{b}\n{c}" }, data: parts.map(p => ({ name: p.name, value: p.value, itemStyle: { color: p.c } })) }],
    });
    $("#repo-unattr").innerHTML =
      `<p style="margin:2px 0 4px"><b style="color:#909399">⚪ 公共服务/基础设施(${R.unattr_infra_n})</b> —— 本就不是业务服务,不需要独立 AI 流水线:</p>`
      + R.unattr_infra_sample.map(n => `<span class="pill" style="background:#909399;margin:2px 3px">${esc(n)}</span>`).join("")
      + `<p style="margin:12px 0 4px"><b style="color:#b03a3a">🔴 活跃业务仓(${R.unattr_active_n},样例 ${R.unattr_active_sample.length})</b> —— 这些是真正的「可能该接但还没接」:</p>`
      + R.unattr_active_sample.map(n => `<span class="pill" style="background:#b03a3a;margin:2px 3px">${esc(n)}</span>`).join("")
      + `<p style="color:var(--t2);margin-top:12px"><b>怎么看:</b>全 org 445 仓里 <b>246 个已归档</b>(历史仓,不计)。活跃仓约 ${active} 个:${R.covered_by_integrated} 个被已跑 AI 的服务覆盖、${R.cat["已注册未接入"] || 0} 个属已建服务但没触发过、剩下 <b>${R.unattr_active_n + R.unattr_infra_n} 个未归属</b>(其中 ${R.unattr_infra_n} 个是公共基建、${R.unattr_active_n} 个是活跃业务仓)。<b>归属靠 umbrella + .gitmodules 匹配,属近似</b>——个别子仓命名不一致可能漏匹配。</p>`;
  }
  function renderCoverage(C) {
    const kp = [
      ["服务总数(umbrella 仓)", C.total_svc, ""],
      ["🟢 已接入过 AI", C.ever, "≥1 个 issue"],
      ["🔴 从未接入", C.never, "0 个 issue"],
    ];
    $("#cov-kpis").innerHTML = kp.map(([k, v, x]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${x ? `<small>${x}</small>` : ""}</div></div>`).join("");
    const rows = C.rows.slice().reverse(); // 图从下往上,把从未接入的放最下
    ec("c-cov").setOption({
      grid: { left: 210, right: 50, top: 24, bottom: 20 },
      legend: { data: ["已接入 issue", "有归属未接入"], top: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => { const r = rows[p[0].dataIndex]; return `${r.cn}<br/>已接入 ${r.got} · 有归属未接入 ${r.notint}<br/>${r.ever ? "🟢 已接入" : "🔴 从未接入过 AI"}`; } },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: rows.map(r => (r.ever ? "" : "🔴 ") + (r.cn.length > 14 ? r.cn.slice(0, 14) + "…" : r.cn)) },
      series: [
        { name: "已接入 issue", type: "bar", stack: "x", barMaxWidth: 18, data: rows.map(r => ({ value: r.got, itemStyle: { color: "#3ba272" } })), label: { show: true, position: "insideRight", color: "#fff", formatter: p => p.value || "" } },
        { name: "有归属未接入", type: "bar", stack: "x", barMaxWidth: 18, data: rows.map(r => ({ value: r.notint, itemStyle: { color: "#c9ccd1" } })) },
      ],
    });
    const never = C.rows.filter(r => !r.ever);
    $("#cov-never").innerHTML = never.map(r => `<span class="pill" style="background:#b03a3a;margin:3px 4px 3px 0">${esc(r.cn)}</span>`).join("")
      + `<div style="color:var(--t3);margin-top:8px">共 ${never.length} 个服务从未接入。另有 <b>${(Object.keys(C.unmapped_integrated || {}).length)}</b> 类标签(oss-map / 未分服务)不在标准服务清单内。</div>`;
    renderCovTable(C);
  }
  const RC = { "已接入": "#3ba272", "无issue": "#909399", "非业务": "#909399", "有issue未触发": "#e6a23c" };
  function renderCovTable(C) {
    const sum = C.reason_summary || {};
    $("#cov-reason-sum").innerHTML = Object.entries(sum).map(([k, v]) =>
      `<span class="pill" style="background:${RC[k] || "#888"};margin-right:6px">${esc(k)} ${v}</span>`).join("")
      + `<span style="color:#b03a3a;font-weight:700;margin-left:6px">技术不能接入:${C.tech_blocked ?? 0} 个</span>`;
    const order = { "已接入": 0, "有issue未触发": 1, "无issue": 2, "非业务": 3 };
    const rows = C.rows.slice().sort((a, b) => (order[a.reason_cat] - order[b.reason_cat]) || (b.got - a.got));
    const body = rows.map(r => `<tr>
      <td><b>${esc(r.id)}</b><div style="color:var(--t3);font-size:12px">${esc(r.cn)}</div></td>
      <td style="text-align:center">${r.got || "—"}</td>
      <td style="text-align:center">${r.issue_count ?? "—"}</td>
      <td><span class="pill" style="background:${RC[r.reason_cat] || "#888"}">${esc(r.reason_cat)}</span></td>
      <td style="color:var(--t2)">${esc(r.reason)}</td></tr>`).join("");
    $("#cov-table").innerHTML = `<thead><tr><th>服务(umbrella 仓)</th><th>已接入 issue</th><th>backlog issue 总数</th><th>状态</th><th>为什么没接入 / 说明</th></tr></thead><tbody>${body}</tbody>`;
  }
  function renderKpis() {
    const s = D.summary;
    const cards = [
      ["未接入总数", D.total, "轮次=0"],
      ["🟢 可补归属接入", s.fix, "补 project 标签"],
      ["🟡 走评审即可", s.proc, "打 accepted"],
      ["⚪ 合理不接入", s.out, "CVE/讨论/关闭"],
    ];
    $("#kpis").innerHTML = cards.map(([k, v, x]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${x ? `<small>${x}</small>` : ""}</div></div>`).join("");
  }
  function renderReason() {
    const arr = Object.entries(D.by_reason).sort((a, b) => a[1] - b[1]);
    ec("c-reason").setOption({
      grid: { left: 260, right: 44, top: 10, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => { const w = arr[p[0].dataIndex][0]; return `${w}<br/>${p[0].value} 个 · ${D.fixdesc[w] || ""}`; } },
      xAxis: { type: "value" }, yAxis: { type: "category", data: arr.map(x => x[0].length > 22 ? x[0].slice(0, 22) + "…" : x[0]) },
      series: [{ type: "bar", barMaxWidth: 24, data: arr.map(x => ({ value: x[1], itemStyle: { color: FIXCOLOR[D.fixcat[x[0]]] || "#888" } })), label: { show: true, position: "right" } }],
    });
  }
  function renderTypeScen() {
    const t = Object.entries(D.by_scenario).sort((a, b) => b[1] - a[1]);
    ec("c-typescen").setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { type: "scroll", bottom: 0 },
      series: [{ type: "pie", radius: ["38%", "66%"], center: ["50%", "44%"], label: { formatter: "{b} {c}" }, data: t.map(x => ({ name: x[0], value: x[1] })) }],
    });
  }
  function renderSvc() {
    const arr = Object.entries(D.by_service).sort((a, b) => a[1] - b[1]);
    ec("c-svc").setOption({
      grid: { left: 140, right: 44, top: 10, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value" }, yAxis: { type: "category", data: arr.map(x => x[0]) },
      series: [{ type: "bar", barMaxWidth: 18, data: arr.map(x => x[1]), itemStyle: { color: "#8a7226" }, label: { show: true, position: "right" } }],
    });
  }
  let fR = "__all__", fS = "__all__";
  function initTable() {
    const rs = [...new Set(D.issues.map(i => i.why))];
    $("#f-reason").innerHTML = '<option value="__all__">全部原因</option>' + rs.map(r => `<option>${esc(r)}</option>`).join("");
    const ss = [...new Set(D.issues.map(i => i.service))].sort();
    $("#f-svc").innerHTML = '<option value="__all__">全部服务</option>' + ss.map(s => `<option>${esc(s)}</option>`).join("");
    $("#f-reason").addEventListener("change", e => { fR = e.target.value; draw(); });
    $("#f-svc").addEventListener("change", e => { fS = e.target.value; draw(); });
    draw();
  }
  function draw() {
    let rows = D.issues.slice();
    if (fR !== "__all__") rows = rows.filter(r => r.why === fR);
    if (fS !== "__all__") rows = rows.filter(r => r.service === fS);
    $("#cnt").textContent = `共 ${rows.length} 个`;
    const body = rows.map(r => `<tr>
      <td><a href="https://github.com/opensourceways/backlog/issues/${r.n}" target="_blank" rel="noopener">#${r.n}</a></td>
      <td>${esc(r.type)}</td><td style="color:var(--t3)">${esc(r.scenario)}</td>
      <td style="color:var(--t2)">${esc(r.service)}</td>
      <td><span style="color:${r.state === "open" ? "#b8860b" : "#3ba272"}">${esc(r.state)}</span></td>
      <td><span class="pill" style="background:${FIXCOLOR[D.fixcat[r.why]] || "#888"}">${esc(r.why)}</span></td></tr>`).join("");
    $("#tbl").innerHTML = `<thead><tr><th>#</th><th>类型</th><th>场景</th><th>服务</th><th>状态</th><th>未接入原因</th></tr></thead><tbody>${body}</tbody>`;
  }
})();
