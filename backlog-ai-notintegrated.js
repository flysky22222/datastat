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
    fetch("./backlog-ai-notintegrated-repodetail.json?t=" + Date.now())
      .then(r => r.ok ? r.json() : null).then(c => { if (c) initRepoDetail(c); }).catch(() => {});
  }
  let RD = [], rdGap = false, rdNeed = false;
  const FC = { repo: "", svc: "__all__", merged: "__all__", ai_pr: "__all__", integrated: "__all__", claude_md: "__all__", skills: "__all__" };
  const yn = b => b ? '<span style="color:#3ba272;font-weight:700">✅</span>' : '<span style="color:var(--t3)">—</span>';
  const onWf = r => !!(r.integrated || r.ai_pr);        // 接入AI workflow = 属已跑AI的服务 或 本仓真收到过AI PR
  const wfState = r => r.na ? "na" : (onWf(r) ? "y" : "n"); // na=不涉及(基建/workflow本身)
  const needInteg = r => (r.merged || 0) > 0 && !onWf(r) && !r.na; // 需接入 = 有合入PR·没被AI碰过·非基建
  const b3 = id => `<select data-fc="${id}" style="width:100%;font-size:12px;padding:3px 4px"><option value="__all__">全部</option><option value="y">✅ 有</option><option value="n">— 无</option></select>`;
  function initRepoDetail(list) {
    RD = list;
    const n = list.length, cmd = list.filter(r => r.claude_md).length,
      integ = list.filter(r => onWf(r) && !r.na).length, naN = list.filter(r => r.na).length,
      gapReady = list.filter(r => r.ai_pr && (!r.claude_md || !r.skills)).length,
      need = list.filter(needInteg).length;
    const cards = [
      ["活跃仓总数", n, "排归档/fork"], ["✅ 接入 AI workflow", integ, ""],
      ["🎯 需接入", need, "有合入·没接AI"], ["🚫 不涉及", naN, "基建/workflow本身"],
      ["有 CLAUDE.md", cmd, `${Math.round(cmd / n * 100)}%`], ["⚠️ 跑了AI但缺文档", gapReady, "有PR无CLAUDE/skill"],
    ];
    $("#rd-sum").innerHTML = '<div class="kpis">' + cards.map(([k, v, x]) =>
      `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${x ? `<small>${x}</small>` : ""}</div></div>`).join("") + '</div>';
    // 建表头 + 逐列筛选行(只建一次,避免重绘丢焦点)
    const svcs = [...new Set(list.map(r => r.svc).filter(Boolean))].sort();
    const svcOpts = '<option value="__all__">全部</option><option value="__none__">未归属</option>' + svcs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    $("#rdtbl").innerHTML =
      `<thead>
        <tr><th>仓库名称</th><th>归属服务</th><th>合入PR</th><th>有 AI PR</th><th>接入 workflow</th><th>CLAUDE.md</th><th>skills</th></tr>
        <tr style="position:sticky;top:0">
          <th><input data-fc="repo" placeholder="搜索名称…" style="width:100%;font-size:12px;padding:3px 5px" /></th>
          <th><select data-fc="svc" style="width:100%;font-size:12px;padding:3px 4px">${svcOpts}</select></th>
          <th><select data-fc="merged" style="width:100%;font-size:12px;padding:3px 4px"><option value="__all__">全部</option><option value="y">有合入(&gt;0)</option><option value="n">无合入</option></select></th>
          <th>${b3("ai_pr")}</th><th><select data-fc="integrated" style="width:100%;font-size:12px;padding:3px 4px"><option value="__all__">全部</option><option value="y">✅ 接入</option><option value="n">— 未接入</option><option value="na">🚫 不涉及</option></select></th><th>${b3("claude_md")}</th><th>${b3("skills")}</th>
        </tr>
      </thead><tbody id="rdbody"></tbody>`;
    $("#rdtbl").querySelectorAll("[data-fc]").forEach(el => {
      const ev = el.tagName === "INPUT" ? "input" : "change";
      el.addEventListener(ev, e => { FC[el.dataset.fc] = e.target.value; drawRD(); });
    });
    $("#rd-gap").addEventListener("change", e => { rdGap = e.target.checked; drawRD(); });
    $("#rd-need").addEventListener("change", e => { rdNeed = e.target.checked; drawRD(); });
    $("#rd-reset").addEventListener("click", () => {
      Object.keys(FC).forEach(k => FC[k] = k === "repo" ? "" : "__all__");
      rdGap = false; rdNeed = false; $("#rd-gap").checked = false; $("#rd-need").checked = false;
      $("#rdtbl").querySelectorAll("[data-fc]").forEach(el => { el.value = el.tagName === "INPUT" ? "" : "__all__"; });
      drawRD();
    });
    renderNeed(list);
    drawRD();
  }
  const boolMatch = (f, v) => f === "__all__" || (f === "y") === !!v;
  function renderNeed(list) {
    const need = list.filter(needInteg).sort((a, b) => (b.merged || 0) - (a.merged || 0));
    const svcHas = need.filter(r => r.svc).length;
    $("#need-sum").innerHTML = `<span class="pill" style="background:#d48806;font-size:14px;padding:3px 12px">需接入的仓:${need.length} 个</span>
      <span style="color:var(--t2);margin-left:10px">其中 ${need.filter(r => !r.svc).length} 个未归属任何服务、${svcHas} 个属已注册服务但该服务没跑过 AI。合入 PR 越多 = 开发越活跃 = 越该优先接。</span>`;
    const body = need.map((r, i) => `<tr${needInteg(r) ? ' style="background:#fff1b8"' : ''}>
      <td style="text-align:center;color:var(--t3)">${i + 1}</td>
      <td><a href="https://github.com/opensourceways/${esc(r.repo)}" target="_blank" rel="noopener"><b>${esc(r.repo)}</b></a> ${r.private ? '<span class="pill" style="background:#909399;font-size:10px">私</span>' : '<span class="pill" style="background:#3ba272;font-size:10px">公</span>'}</td>
      <td style="color:var(--t2)">${r.svc ? esc(r.svc) : '<span style="color:#b03a3a">未归属</span>'}</td>
      <td style="text-align:center;font-weight:700;color:#ad6800">${r.merged || 0}</td>
      <td style="text-align:center">${yn(r.claude_md)}</td>
      <td style="text-align:center">${yn(r.skills)}</td></tr>`).join("");
    $("#need-tbl").innerHTML = `<thead><tr><th>#</th><th>仓库名称</th><th>归属服务</th><th>合入 PR 数</th><th>CLAUDE.md</th><th>skills</th></tr></thead><tbody>${body}</tbody>`;
  }
  function drawRD() {
    let rows = RD.slice();
    if (FC.repo) { const q = FC.repo.toLowerCase(); rows = rows.filter(r => r.repo.toLowerCase().includes(q)); }
    if (FC.svc === "__none__") rows = rows.filter(r => !r.svc);
    else if (FC.svc !== "__all__") rows = rows.filter(r => r.svc === FC.svc);
    if (FC.merged !== "__all__") rows = rows.filter(r => FC.merged === "y" ? (r.merged || 0) > 0 : (r.merged || 0) === 0);
    rows = rows.filter(r => boolMatch(FC.ai_pr, r.ai_pr) && (FC.integrated === "__all__" || FC.integrated === wfState(r)) && boolMatch(FC.claude_md, r.claude_md) && boolMatch(FC.skills, r.skills));
    if (rdGap) rows = rows.filter(r => r.ai_pr && (!r.claude_md || !r.skills));
    if (rdNeed) rows = rows.filter(needInteg);
    rows.sort((a, b) => (needInteg(b) - needInteg(a)) || (b.merged || 0) - (a.merged || 0) || (b.integrated - a.integrated) || a.repo.localeCompare(b.repo));
    $("#rd-cnt").textContent = `共 ${rows.length} 个仓`;
    $("#rdbody").innerHTML = rows.map(r => `<tr${needInteg(r) ? ' style="background:#fff1b8"' : ''}>
      <td><a href="https://github.com/opensourceways/${esc(r.repo)}" target="_blank" rel="noopener">${esc(r.repo)}</a> ${r.private ? '<span class="pill" style="background:#909399;font-size:10px">私</span>' : '<span class="pill" style="background:#3ba272;font-size:10px">公</span>'}${needInteg(r) ? ' <span class="pill" style="background:#d48806;font-size:10px">🎯需接入</span>' : ''}</td>
      <td style="color:var(--t2)">${r.svc ? esc(r.svc) : '<span style="color:#b03a3a">未归属</span>'}</td>
      <td style="text-align:center;color:#ad6800">${r.merged || 0}</td>
      <td style="text-align:center">${yn(r.ai_pr)}</td>
      <td style="text-align:center">${r.na ? '<span style="color:var(--t3);font-size:12px">🚫不涉及</span>' : yn(onWf(r))}</td>
      <td style="text-align:center">${yn(r.claude_md)}</td>
      <td style="text-align:center">${yn(r.skills)}</td></tr>`).join("");
  }
  function renderRepos(R) {
    const active = R.active != null ? R.active : (R.total - R.archived - R.fork_active);
    const kp = [
      ["opensourceways 全 org 仓", R.total, `公 ${R.public}/私 ${R.private}`],
      ["活跃仓(排归档/fork)", active, `归档 ${R.archived}+活跃fork ${R.fork_active}`],
      ["🟢 接入 AI 的仓", R.cat["接入AI"], ""],
      ["🎯 需接入的仓", R.need_integrate, "有合入·没接AI"],
    ];
    $("#repo-kpis").innerHTML = kp.map(([k, v, x]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${x ? `<small>${x}</small>` : ""}</div></div>`).join("");
    const parts = [
      { name: "🟢 接入 AI", value: R.cat["接入AI"] || 0, c: "#3ba272" },
      { name: "🟡 已注册未接入", value: R.cat["已注册未接入"] || 0, c: "#e6a23c" },
      { name: "🔴 未归属", value: R.cat["未归属"] || 0, c: "#b03a3a" },
      { name: "🚫 不涉及(基建/workflow)", value: R.cat["不涉及"] || 0, c: "#909399" },
    ];
    ec("c-repo").setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} 仓 ({d}%)" }, legend: { type: "scroll", bottom: 0 },
      series: [{ type: "pie", radius: ["40%", "68%"], center: ["50%", "44%"], label: { formatter: "{b}\n{c}" }, data: parts.map(p => ({ name: p.name, value: p.value, itemStyle: { color: p.c } })) }],
    });
    $("#repo-unattr").innerHTML =
      `<p style="margin:2px 0 4px"><b style="color:#b03a3a">🔴 未归属仓(${R.unattr_n})</b> —— 不属于任何已注册服务,多数有真实开发(在「需接入」里):</p>`
      + (R.unattr_sample || []).map(n => `<span class="pill" style="background:#b03a3a;margin:2px 3px">${esc(n)}</span>`).join("")
      + `<p style="margin:12px 0 4px"><b style="color:#909399">🚫 不涉及(${R.na_n})</b> —— 基建/配置/workflow 本身(如 backlog、infra-*、argocd、helm),不需要接入 AI 流水线:</p>`
      + (R.na_sample || []).map(n => `<span class="pill" style="background:#909399;margin:2px 3px">${esc(n)}</span>`).join("")
      + `<p style="color:var(--t2);margin-top:12px"><b>怎么看:</b>全 org <b>${R.total} 仓 = 归档 ${R.archived} + 活跃非fork ${active} + 活跃fork ${R.fork_active}</b>。活跃 ${active} 个:🟢 ${R.cat["接入AI"]} 接入、🟡 ${R.cat["已注册未接入"]} 已注册未接入、🔴 ${R.cat["未归属"]} 未归属、🚫 ${R.cat["不涉及"]} 不涉及(基建/workflow)。其中 <b style="color:#d48806">${R.need_integrate} 个有真实 PR 合入却没接 AI = 最该接入</b>。<b>归属靠 umbrella + .gitmodules 匹配,属近似</b>——个别子仓命名不一致可能漏匹配。</p>`;
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
