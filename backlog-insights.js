(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STAGE_KEYS = ["analyze", "implement", "deploy", "release"];
  const STAGE_LABEL = { analyze: "分析", implement: "实现", deploy: "上线测试", release: "发布正式" };
  const LABEL_STAGE = { "分析": "analyze", "实现": "implement", "上线测试": "deploy", "发布正式": "release" };
  const TYPE_ORDER = ["需求", "缺陷", "任务", "CVE", "其他"];
  const TYPE_COLOR = { "需求": "#5470c6", "缺陷": "#ee6666", "任务": "#fac858", "CVE": "#9a60b4", "其他": "#91cc75" };
  const STATE_COLOR = { open: "#fac858", closed: "#3ba272" };
  const AI_COLOR = { "AI 需求": "#5470c6", "非 AI 需求": "#c8ccd4" };
  const STAGE_COLOR = { analyze: "#73c0de", implement: "#5470c6", deploy: "#fac858", release: "#3ba272" };
  const TIER_COLOR = { green: "#3ba272", yellow: "#fac858", red: "#ee6666" };
  const TIER_LABEL = { green: "🟢 已能完成", yellow: "🟡 优化可完成", red: "🔴 还差很远" };

  let RECORDS = [];
  const charts = {};
  const ui = { dim: "aipart", state: "all", scope: "all", svc: "__all__", month: "__all__", distStage: "total", svcdim: "state", svctype: "all" };
  const AIPART_COLOR = { "AI 参与": "#5470c6", "非 AI 参与": "#d5d9e0" };

  function ec(id) {
    if (!charts[id]) charts[id] = echarts.init(document.getElementById(id));
    return charts[id];
  }
  window.addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));
  const uniqSorted = arr => [...new Set(arr.filter(Boolean))].sort();

  fetch("./backlog-insights.json?t=" + Date.now())
    .then(r => { if (!r.ok) throw new Error("backlog-insights.json " + r.status); return r.json(); })
    .then(d => { RECORDS = d.records || []; $("#genAt").textContent = d.generatedAt ? "数据生成于 " + d.generatedAt : ""; init(); })
    .catch(e => { const el = $("#err"); el.hidden = false; el.textContent = "数据加载失败：" + (e.message || e); });

  function init() {
    seg("#seg-dim", v => { ui.dim = v; renderRow2(); });
    seg("#seg-state", v => { ui.state = v; renderRow2(); });
    seg("#seg-scope", v => { ui.scope = v; renderRow3(); });
    seg("#seg-stage", v => { ui.distStage = v; renderDist(); });
    seg("#seg-svcdim", v => { ui.svcdim = v; renderRow5(); });
    seg("#seg-svctype", v => { ui.svctype = v; renderRow5(); });

    const svcCnt = {};
    RECORDS.forEach(r => { if (r.roundsTotal > 0) svcCnt[r.service] = (svcCnt[r.service] || 0) + 1; });
    const svcs = Object.keys(svcCnt).sort((a, b) => svcCnt[b] - svcCnt[a] || a.localeCompare(b));
    $("#sel-svc").innerHTML = ['<option value="__all__">全部服务</option>']
      .concat(svcs.map(s => `<option value="${esc(s)}">${esc(s)}（${svcCnt[s]}）</option>`)).join("");
    $("#sel-svc").addEventListener("change", e => { ui.svc = e.target.value; renderRow3(); });

    const months = uniqSorted(RECORDS.map(r => r.createdMonth));
    $("#sel-month").innerHTML = ['<option value="__all__">全部月份</option>']
      .concat(months.map(m => `<option value="${m}">${m}</option>`)).join("");
    $("#sel-month").addEventListener("change", e => { ui.month = e.target.value; renderRow3(); });

    $("#detail-close").addEventListener("click", () => { $("#detail").hidden = true; });

    renderKpis();
    renderRow1();
    renderFunnel();
    renderRow2();
    renderRow3();
    renderRow4();
    renderRow5();
  }

  function seg(sel, cb) {
    const box = $(sel);
    box.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      box.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
      cb(b.dataset.v);
    });
  }

  // ── 点击钻取明细表 ──
  function showDetail(label, recs) {
    const box = $("#detail");
    box.hidden = false;
    $("#detail-title").textContent = `明细：${label}（${recs.length} 条）`;
    const rows = recs.slice().sort((a, b) => b.roundsTotal - a.roundsTotal).map(r => `
      <tr style="border-bottom:1px solid var(--line)">
        <td style="padding:6px 8px;white-space:nowrap"><a href="https://github.com/opensourceways/backlog/issues/${r.n}" target="_blank" rel="noopener">#${r.n}</a></td>
        <td style="padding:6px 8px">${esc(r.title)}</td>
        <td style="padding:6px 8px;white-space:nowrap">${esc(r.type)}</td>
        <td style="padding:6px 8px;white-space:nowrap">${esc(r.scenario || "")}</td>
        <td style="padding:6px 8px;white-space:nowrap;color:var(--t2)">${esc(r.service)}</td>
        <td style="padding:6px 8px;white-space:nowrap"><span style="color:${r.state === "open" ? "#b8860b" : "#3ba272"}">${r.state}</span></td>
        <td style="padding:6px 8px;text-align:center">${r.ai ? "✅" : ""}</td>
        <td style="padding:6px 8px;text-align:center">${r.rounds.analyze || ""}</td>
        <td style="padding:6px 8px;text-align:center">${r.rounds.implement || ""}</td>
        <td style="padding:6px 8px;text-align:center">${r.rounds.deploy || ""}</td>
        <td style="padding:6px 8px;text-align:center">${r.rounds.release || ""}</td>
        <td style="padding:6px 8px;text-align:center;font-weight:700">${r.roundsTotal || ""}</td>
      </tr>`).join("");
    $("#detail-table").innerHTML =
      `<thead><tr style="text-align:left;color:var(--t3);border-bottom:2px solid var(--line)">
        <th style="padding:6px 8px">#</th><th style="padding:6px 8px">标题</th><th style="padding:6px 8px">类型</th>
        <th style="padding:6px 8px">场景</th><th style="padding:6px 8px">服务</th><th style="padding:6px 8px">状态</th>
        <th style="padding:6px 8px" title="是否 AI 需求">AI</th>
        <th style="padding:6px 8px">分析</th><th style="padding:6px 8px">实现</th><th style="padding:6px 8px">上线</th><th style="padding:6px 8px">发布</th><th style="padding:6px 8px">总轮</th>
      </tr></thead><tbody>${rows}</tbody>`;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function onClick(id, fn) { const c = ec(id); c.off("click"); c.on("click", fn); }

  // ── 第一排 ──
  function renderKpis() {
    const aiOf = arr => arr.filter(r => r.roundsTotal > 0).length;   // AI 参与 = 进过流水线
    const T = t => RECORDS.filter(r => r.type === t);
    const cards = [
      ["Issue 总数", RECORDS], ["需求", T("需求")], ["缺陷", T("缺陷")], ["任务", T("任务")],
      ["CVE", T("CVE")], ["其他", T("其他")],
      ["待处理 open", RECORDS.filter(r => r.state === "open")],
      ["已关闭 closed", RECORDS.filter(r => r.state === "closed")],
    ];
    let html = cards.map(([k, arr]) => {
      const ai = aiOf(arr), tot = arr.length, p = tot ? Math.round(ai / tot * 100) : 0;
      return `<div class="kpi"><div class="k">${k} <span style="color:#5470c6;font-weight:600">(AI/总)</span></div>
        <div class="v" style="color:#5470c6">${ai}<small style="color:var(--t2)">/${tot} · ${p}%</small></div></div>`;
    }).join("");
    const aiReq = RECORDS.filter(r => r.ai).length;
    html += `<div class="kpi"><div class="k">AI 需求(实现过)</div><div class="v">${aiReq}<small>/${T("需求").length} 需求</small></div></div>`;
    $("#kpis").innerHTML = html;
  }

  function renderRow1() {
    // 各类型：AI 参与 / 非 AI 参与 堆叠
    const aiArr = TYPE_ORDER.map(t => RECORDS.filter(r => r.type === t && r.roundsTotal > 0).length);
    const nonArr = TYPE_ORDER.map(t => RECORDS.filter(r => r.type === t && r.roundsTotal === 0).length);
    ec("c-type").setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { bottom: 0 },
      grid: { left: 40, right: 20, top: 20, bottom: 46 },
      xAxis: { type: "category", data: TYPE_ORDER }, yAxis: { type: "value" },
      series: [
        { name: "AI 参与", type: "bar", stack: "s", data: aiArr, itemStyle: { color: AIPART_COLOR["AI 参与"] }, barMaxWidth: 54, label: { show: true, position: "inside", color: "#fff" } },
        { name: "非 AI 参与", type: "bar", stack: "s", data: nonArr, itemStyle: { color: AIPART_COLOR["非 AI 参与"] }, label: { show: true, position: "inside", color: "#666" } },
      ],
    });
    onClick("c-type", p => showDetail(`${p.name} · ${p.seriesName}`, RECORDS.filter(r => r.type === p.name && (p.seriesName === "AI 参与" ? r.roundsTotal > 0 : r.roundsTotal === 0))));

    // 整体 AI 渗透率饼
    const aiN = RECORDS.filter(r => r.roundsTotal > 0).length;
    ec("c-state").setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 },
      series: [{
        type: "pie", radius: ["42%", "68%"], center: ["50%", "46%"], label: { formatter: "{b}\n{c} ({d}%)" },
        data: [
          { name: "AI 参与", value: aiN, itemStyle: { color: AIPART_COLOR["AI 参与"] } },
          { name: "非 AI 参与", value: RECORDS.length - aiN, itemStyle: { color: AIPART_COLOR["非 AI 参与"] } },
        ],
      }],
    });
    onClick("c-state", p => showDetail(p.name, RECORDS.filter(r => p.name === "AI 参与" ? r.roundsTotal > 0 : r.roundsTotal === 0)));
  }

  // ── 第二排 ──
  function seriesForDim(subset, monthField, months) {
    if (ui.dim === "aipart") {
      return [
        { name: "AI 参与", type: "bar", stack: "s", itemStyle: { color: AIPART_COLOR["AI 参与"] }, barMaxWidth: 40, data: months.map(m => subset.filter(r => r[monthField] === m && r.roundsTotal > 0).length) },
        { name: "非 AI 参与", type: "bar", stack: "s", itemStyle: { color: AIPART_COLOR["非 AI 参与"] }, barMaxWidth: 40, data: months.map(m => subset.filter(r => r[monthField] === m && r.roundsTotal === 0).length) },
      ];
    }
    if (ui.dim === "type") {
      return TYPE_ORDER.map(t => ({
        name: t, type: "bar", stack: "s", itemStyle: { color: TYPE_COLOR[t] }, barMaxWidth: 40,
        data: months.map(m => subset.filter(r => r[monthField] === m && r.type === t).length),
      }));
    }
    const req = subset.filter(r => r.type === "需求");
    return [
      { name: "AI 需求", type: "bar", stack: "s", itemStyle: { color: AI_COLOR["AI 需求"] }, barMaxWidth: 40, data: months.map(m => req.filter(r => r[monthField] === m && r.ai).length) },
      { name: "非 AI 需求", type: "bar", stack: "s", itemStyle: { color: AI_COLOR["非 AI 需求"] }, barMaxWidth: 40, data: months.map(m => req.filter(r => r[monthField] === m && !r.ai).length) },
    ];
  }
  // 叠加「AI 参与」折线：当月进过流水线（roundsTotal>0）的 issue 数
  function aiLine(subset, monthField, months) {
    return {
      name: "AI 参与", type: "line", smooth: true, symbol: "circle", symbolSize: 7, z: 5,
      itemStyle: { color: "#002fa7" }, lineStyle: { color: "#002fa7", width: 2.5 },
      label: { show: true, color: "#002fa7", fontSize: 10 },
      data: months.map(m => subset.filter(r => r[monthField] === m && r.roundsTotal > 0).length),
    };
  }
  // 依据点击的 series 名 + 月份，还原子集
  function drillMonth(subset, monthField, month, seriesName) {
    let base = subset.filter(r => r[monthField] === month);
    if (seriesName === "AI 参与") return base.filter(r => r.roundsTotal > 0);
    if (seriesName === "非 AI 参与") return base.filter(r => r.roundsTotal === 0);
    if (ui.dim === "type") return base.filter(r => r.type === seriesName);
    base = base.filter(r => r.type === "需求");
    return seriesName === "AI 需求" ? base.filter(r => r.ai) : base.filter(r => !r.ai);
  }

  function renderRow2() {
    let sub = RECORDS.slice();
    if (ui.state !== "all") sub = sub.filter(r => r.state === ui.state);
    const monthsNew = uniqSorted(RECORDS.map(r => r.createdMonth));
    const dimTxt = { aipart: "AI 参与/非AI 参与", type: "各类型（含 AI 参与折线）", ai: "AI/非AI 需求" }[ui.dim];
    $("#sub-new").textContent = "柱=" + dimTxt + (ui.state === "all" ? "" : ` · 仅 ${ui.state}`);
    const s1 = seriesForDim(sub, "createdMonth", monthsNew);
    if (ui.dim === "type") s1.push(aiLine(sub, "createdMonth", monthsNew));
    baseBar("c-new", monthsNew, s1);
    onClick("c-new", p => showDetail(`${p.name} 新增 · ${p.seriesName}`, drillMonth(sub, "createdMonth", p.name, p.seriesName)));

    const closedRecs = RECORDS.filter(r => r.closedMonth);
    const monthsClosed = uniqSorted(closedRecs.map(r => r.closedMonth));
    const s2 = seriesForDim(closedRecs, "closedMonth", monthsClosed);
    if (ui.dim === "type") s2.push(aiLine(closedRecs, "closedMonth", monthsClosed));
    baseBar("c-closed", monthsClosed, s2);
    onClick("c-closed", p => showDetail(`${p.name} 关闭 · ${p.seriesName}`, drillMonth(closedRecs, "closedMonth", p.name, p.seriesName)));
  }

  function baseBar(id, cats, series) {
    ec(id).setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { bottom: 0, type: "scroll" },
      grid: { left: 44, right: 20, top: 20, bottom: 42 },
      xAxis: { type: "category", data: cats }, yAxis: { type: "value" }, series,
    }, true);
  }

  // ── 第三排 ──
  function row3Base() {
    let b = RECORDS.filter(r => r.roundsTotal > 0);
    if (ui.scope !== "all") b = b.filter(r => r.type === ui.scope);
    return b;
  }
  function row3Subset() {
    let sub = row3Base();
    if (ui.svc !== "__all__") sub = sub.filter(r => r.service === ui.svc);
    if (ui.month !== "__all__") sub = sub.filter(r => r.createdMonth === ui.month);
    return sub;
  }
  function renderRow3() { renderStageTotal(); renderStageMonth(); renderStageSvc(); renderDist(); }
  function sumStage(recs, k) { return recs.reduce((a, r) => a + (r.rounds[k] || 0), 0); }

  function renderStageTotal() {
    const sub = row3Subset();
    ec("c-stage").setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: { type: "category", data: STAGE_KEYS.map(k => STAGE_LABEL[k]) }, yAxis: { type: "value" },
      series: [{ type: "bar", barMaxWidth: 60, label: { show: true, position: "top" }, data: STAGE_KEYS.map(k => ({ value: sumStage(sub, k), itemStyle: { color: STAGE_COLOR[k] } })) }],
    }, true);
    onClick("c-stage", p => { const k = LABEL_STAGE[p.name]; showDetail(`${p.name}阶段有交互的 issue`, sub.filter(r => r.rounds[k] > 0)); });
  }

  function renderStageMonth() {
    let sub = row3Base();
    if (ui.svc !== "__all__") sub = sub.filter(r => r.service === ui.svc);
    const months = uniqSorted(sub.map(r => r.createdMonth));
    const series = STAGE_KEYS.map(k => ({
      name: STAGE_LABEL[k], type: "bar", stack: "s", itemStyle: { color: STAGE_COLOR[k] }, barMaxWidth: 40,
      data: months.map(m => sumStage(sub.filter(r => r.createdMonth === m), k)),
    }));
    baseBar("c-stage-month", months, series);
    onClick("c-stage-month", p => { const k = LABEL_STAGE[p.seriesName]; showDetail(`${p.name} · ${p.seriesName}`, sub.filter(r => r.createdMonth === p.name && r.rounds[k] > 0)); });
  }

  function renderStageSvc() {
    let sub = row3Base();
    if (ui.month !== "__all__") sub = sub.filter(r => r.createdMonth === ui.month);
    const svcTotal = {};
    sub.forEach(r => { svcTotal[r.service] = (svcTotal[r.service] || 0) + r.roundsTotal; });
    const top = Object.keys(svcTotal).sort((a, b) => svcTotal[b] - svcTotal[a]).slice(0, 12).reverse();
    const series = STAGE_KEYS.map(k => ({
      name: STAGE_LABEL[k], type: "bar", stack: "s", itemStyle: { color: STAGE_COLOR[k] }, barMaxWidth: 22,
      data: top.map(s => sumStage(sub.filter(r => r.service === s), k)),
    }));
    ec("c-stage-svc").setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { bottom: 0, type: "scroll" },
      grid: { left: 130, right: 24, top: 16, bottom: 42 }, xAxis: { type: "value" }, yAxis: { type: "category", data: top }, series,
    }, true);
    onClick("c-stage-svc", p => { const k = LABEL_STAGE[p.seriesName]; showDetail(`服务 ${p.name} · ${p.seriesName}`, sub.filter(r => r.service === p.name && r.rounds[k] > 0)); });
  }

  function renderDist() {
    const sub = row3Subset();
    const metric = ui.distStage === "total" ? (r => r.roundsTotal) : (r => r.rounds[ui.distStage] || 0);
    const withV = sub.filter(r => metric(r) > 0);
    const vals = withV.map(metric);
    const max = vals.length ? Math.max(...vals) : 0;
    const cats = []; const data = [];
    for (let i = 1; i <= max; i++) { cats.push(String(i)); data.push(vals.filter(v => v === i).length); }
    const issueN = vals.length, totalRounds = vals.reduce((a, b) => a + b, 0), avg = issueN ? (totalRounds / issueN).toFixed(1) : 0;
    const label = ui.distStage === "total" ? "总轮次" : STAGE_LABEL[ui.distStage];
    ec("c-dist").setOption({
      title: { text: `${label} · ${issueN} 个 issue · 平均 ${avg} 轮`, left: "center", top: 4, textStyle: { fontSize: 12, color: "#666", fontWeight: "normal" } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => `${p[0].axisValue} 轮：${p[0].data} 个 issue` },
      grid: { left: 44, right: 20, top: 34, bottom: 40 },
      xAxis: { type: "category", data: cats, name: "轮次数", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: "issue 数" },
      series: [{ type: "bar", barMaxWidth: 34, data, itemStyle: { color: ui.distStage === "total" ? "#5470c6" : STAGE_COLOR[ui.distStage] }, label: { show: max <= 25, position: "top", fontSize: 10 } }],
    }, true);
    onClick("c-dist", p => { const n = Number(p.name); showDetail(`${label} = ${n} 轮`, withV.filter(r => metric(r) === n)); });
  }

  // ── 第四排：场景成熟度 ──
  function scenarioStats() {
    const all = {}, piped = {};
    RECORDS.forEach(r => {
      const s = r.scenario || "其他/未分";
      (all[s] = all[s] || []).push(r);
      if (r.roundsTotal > 0) (piped[s] = piped[s] || []).push(r);
    });
    return Object.keys(all).map(s => {
      const ps = piped[s] || [];
      const n = ps.length;
      const implAvg = n ? ps.reduce((a, r) => a + r.rounds.implement, 0) / n : 0;
      const closeRate = n ? ps.filter(r => r.state === "closed").length / n : 0;
      const tier = n === 0 ? "yellow" : (closeRate >= 0.5 ? "green" : (closeRate < 0.25 ? "red" : "yellow"));
      return { scenario: s, volAll: all[s].length, piped: n, implAvg, closeRate, tier };
    }).sort((a, b) => b.volAll - a.volAll);
  }

  function renderRow4() {
    const stats = scenarioStats();
    // 矩阵：x=平均实现轮次, y=已关闭占比%, size=总量, color=tier
    ec("c-matrix").setOption({
      tooltip: {
        formatter: p => { const d = p.data; return `${d[3]}<br/>总量 ${d[2]} 条 · 进流水线 ${d[4]} 条<br/>平均实现轮 ${d[0].toFixed(1)} · 关闭率 ${(d[1]).toFixed(0)}%<br/>${TIER_LABEL[d[5]]}`; },
      },
      grid: { left: 50, right: 24, top: 24, bottom: 48 },
      xAxis: { type: "value", name: "平均实现轮次 →摩擦大", nameLocation: "middle", nameGap: 28, min: 0 },
      yAxis: { type: "value", name: "已关闭占比 %", min: 0, max: 100 },
      series: [{
        type: "scatter",
        symbolSize: d => 14 + Math.sqrt(d[2]) * 3.2,
        label: { show: true, formatter: p => p.data[3], position: "right", fontSize: 11, color: "#333" },
        data: stats.map(s => ({ value: [s.implAvg, s.closeRate * 100, s.volAll, s.scenario, s.piped, s.tier], itemStyle: { color: TIER_COLOR[s.tier], opacity: 0.82 } })),
      }],
    }, true);
    onClick("c-matrix", p => showDetail(`场景 ${p.data[3]}（全部）`, RECORDS.filter(r => (r.scenario || "其他/未分") === p.data[3])));

    // 覆盖：每场景 总量 vs 已进流水线
    const cats = stats.map(s => s.scenario).reverse();
    const volAll = stats.map(s => s.volAll).reverse();
    const piped = stats.map(s => s.piped).reverse();
    ec("c-coverage").setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { bottom: 0 },
      grid: { left: 90, right: 30, top: 16, bottom: 40 },
      xAxis: { type: "value" }, yAxis: { type: "category", data: cats },
      series: [
        { name: "全部 issue", type: "bar", data: volAll, itemStyle: { color: "#d5d9e0" }, barGap: "-100%", barMaxWidth: 22, label: { show: true, position: "right", color: "#999", fontSize: 11 } },
        { name: "已进 AI 流水线", type: "bar", data: piped, itemStyle: { color: "#5470c6" }, barMaxWidth: 22 },
      ],
    }, true);
    onClick("c-coverage", p => {
      const sc = p.name;
      if (p.seriesName === "已进 AI 流水线") showDetail(`场景 ${sc} · 已进流水线`, RECORDS.filter(r => (r.scenario || "其他/未分") === sc && r.roundsTotal > 0));
      else showDetail(`场景 ${sc}（全部）`, RECORDS.filter(r => (r.scenario || "其他/未分") === sc));
    });
  }

  // ── 需求交付漏斗：总需求 → 已关闭 → AI 参与关闭 ──
  function renderFunnel() {
    const req = RECORDS.filter(r => r.type === "需求");
    const closed = req.filter(r => r.state === "closed");
    const aiClosed = closed.filter(r => r.roundsTotal > 0);
    const tot = req.length || 1;
    const map = { "总需求": req, "已关闭需求": closed, "AI 参与关闭": aiClosed };
    ec("c-funnel").setOption({
      tooltip: { trigger: "item", formatter: p => `${p.name}：${p.value} 条（占总需求 ${(p.value / tot * 100).toFixed(0)}%）` },
      series: [{
        type: "funnel", left: "8%", right: "8%", top: 16, bottom: 16, minSize: "36%", sort: "descending", gap: 3,
        label: { show: true, position: "inside", formatter: p => `${p.name}  ${p.value}（${(p.value / tot * 100).toFixed(0)}%）`, color: "#fff", fontSize: 13, fontWeight: 600 },
        data: [
          { name: "总需求", value: req.length, itemStyle: { color: "#7a92e0" } },
          { name: "已关闭需求", value: closed.length, itemStyle: { color: "#3ba272" } },
          { name: "AI 参与关闭", value: aiClosed.length, itemStyle: { color: "#002fa7" } },
        ],
      }],
    }, true);
    onClick("c-funnel", p => showDetail(p.name, map[p.name] || []));
  }

  // ── 第五排：按服务的 Issue 分布 ──
  function renderRow5() {
    let base = RECORDS.slice();
    if (ui.svctype !== "all") base = base.filter(r => r.type === ui.svctype);
    const map = {};
    base.forEach(r => { (map[r.service] = map[r.service] || []).push(r); });
    const svcs = Object.keys(map).sort((a, b) => map[b].length - map[a].length).slice(0, 20).reverse();
    const totals = svcs.map(s => map[s].length);
    const totLabel = { show: true, position: "right", formatter: p => totals[p.dataIndex], color: "#333", fontSize: 11, fontWeight: 600 };
    let series;
    if (ui.svcdim === "state") {
      series = [
        { name: "open", type: "bar", stack: "s", itemStyle: { color: STATE_COLOR.open }, barMaxWidth: 20, data: svcs.map(s => map[s].filter(r => r.state === "open").length) },
        { name: "closed", type: "bar", stack: "s", itemStyle: { color: STATE_COLOR.closed }, barMaxWidth: 20, data: svcs.map(s => map[s].filter(r => r.state === "closed").length), label: totLabel },
      ];
    } else {
      series = [
        { name: "AI 参与", type: "bar", stack: "s", itemStyle: { color: "#5470c6" }, barMaxWidth: 20, data: svcs.map(s => map[s].filter(r => r.roundsTotal > 0).length) },
        { name: "非 AI 参与", type: "bar", stack: "s", itemStyle: { color: "#c8ccd4" }, barMaxWidth: 20, data: svcs.map(s => map[s].filter(r => r.roundsTotal === 0).length), label: totLabel },
      ];
    }
    ec("c-svc-dist").setOption({
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: params => {
          const s = params[0].name, arr = map[s] || [];
          const open = arr.filter(r => r.state === "open").length, closed = arr.length - open;
          const ai = arr.filter(r => r.roundsTotal > 0).length;
          return `<b>${s}</b><br/>总数 ${arr.length}<br/>open ${open} · closed ${closed}<br/>AI 参与 ${ai} · 非AI ${arr.length - ai}`;
        },
      },
      legend: { bottom: 0 }, grid: { left: 150, right: 48, top: 10, bottom: 40 },
      xAxis: { type: "value" }, yAxis: { type: "category", data: svcs }, series,
    }, true);
    onClick("c-svc-dist", p => {
      const s = p.name, arr = map[s] || [];
      let sub = arr;
      if (p.seriesName === "open") sub = arr.filter(r => r.state === "open");
      else if (p.seriesName === "closed") sub = arr.filter(r => r.state === "closed");
      else if (p.seriesName === "AI 参与") sub = arr.filter(r => r.roundsTotal > 0);
      else if (p.seriesName === "非 AI 参与") sub = arr.filter(r => r.roundsTotal === 0);
      showDetail(`服务 ${s} · ${p.seriesName}`, sub);
    });
  }
})();
