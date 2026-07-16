(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const charts = {};
  const ec = id => charts[id] || (charts[id] = echarts.init(document.getElementById(id)));
  window.addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));

  const CATCOLOR = {
    KNOWLEDGE_MISSING: "#5470c6", OUTPUT_WRONG: "#ee6666", SKILL_MISSING: "#3a5bd0", CLAUDEMD_MISSING: "#9a60b4",
    PREVIEW_FAILED: "#fac858", CI_GATE: "#fc8452", REQUIREMENT_VAGUE: "#73c0de", UI_NO_FEEDBACK: "#5aa9c9",
    DATA_MISSING: "#91cc75", ROBOT_QUALITY: "#ea7ccc", OTHER: "#bbb",
  };
  const STAGECOLOR = { "需求分析": "#73c0de", "开发预览": "#5470c6", "开发提交": "#9a60b4", "测试发布": "#fac858", "正式上线": "#3ba272", "AI引擎故障": "#ee6666", "服务解析/开发": "#fc8452", "其他": "#bbb" };
  let D, DET = {}, IMP = null;

  Promise.all([
    fetch("./backlog-ai-problems.json?t=" + Date.now()).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("./backlog-ai-problems-detail.json?t=" + Date.now()).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch("./backlog-ai-improvement.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([d, det, imp]) => { D = d; DET = det || {}; IMP = imp; init(); })
    .catch(e => { const el = $("#err"); el.style.display = "block"; el.textContent = "数据加载失败:" + e; });

  function init() {
    $("#genAt").textContent = "生成于 " + D.generatedAt;
    renderKpis(); renderTop3(); renderCat(); renderPrimary(); renderStage(); renderFailStage(); renderSvc(); renderCorr();
    initTable();
    if (IMP) { renderIntv(); renderIntvCards(); initImpTable(); }
  }

  function renderCorr() {
    if (!$("#c-corr")) return;
    const pts = D.issues.filter(i => i.lines != null).map(i => ({
      value: [i.rounds, i.lines, i.repos_changed || 1, i.n], itemStyle: { color: CATCOLOR[i.primary] || "#888", opacity: 0.8 },
    }));
    ec("c-corr").setOption({
      grid: { left: 60, right: 24, top: 16, bottom: 44 },
      tooltip: { formatter: p => `#${p.data.value[3]}<br/>轮次 ${p.data.value[0]} · 代码 ${p.data.value[1]} 行 · ${p.data.value[2]} 仓` },
      xAxis: { type: "value", name: "交互轮次 →", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: "代码行数", max: 8000 },
      series: [{ type: "scatter", symbolSize: d => 8 + Math.sqrt(d[2]) * 6, data: pts }],
    });
  }

  function renderIntv() {
    const arr = IMP.intv_impact.slice().reverse();
    const cm = {}; (IMP.plan || []).forEach(p => cm[p.id] = p.color);
    ec("c-intv").setOption({
      grid: { left: 200, right: 50, top: 10, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}<br/>省 ${p[0].value} 小时` },
      xAxis: { type: "value", name: "省(h)" },
      yAxis: { type: "category", data: arr.map(x => x.id + " " + x.name.slice(0, 16)) },
      series: [{ type: "bar", barMaxWidth: 22, data: arr.map(x => ({ value: x.saved_h, itemStyle: { color: cm[x.id] || "#888" } })), label: { show: true, position: "right", formatter: "{c}h" } }],
    });
  }

  function renderIntvCards() {
    $("#intv-cards").innerHTML = (IMP.plan || []).map(p => `
      <div class="card" style="border-left:5px solid ${p.color}">
        <h3>${esc(p.id)} · ${esc(p.name)} <span style="float:right;color:${p.color};font-weight:700">省 ${p.saved_h}h</span></h3>
        <p class="sub" style="color:var(--t2)">${esc(p.do)}</p>
        <div style="font-size:13px"><b>步骤:</b><ol style="margin:4px 0;padding-left:20px;line-height:1.7">${p.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>
        ${p.prompt && p.prompt.indexOf("prompt") < 0 && p.prompt.indexOf("改造") < 0 ? `<div style="font-size:12px;margin-top:6px"><b>给 AI 的 prompt:</b><br/><code style="display:block;padding:6px 8px;background:#f5f6f8;border-radius:6px;margin-top:3px;white-space:pre-wrap">${esc(p.prompt)}</code></div>` : `<div style="font-size:12px;color:var(--t3);margin-top:6px">${esc(p.prompt)}</div>`}
      </div>`).join("");
  }

  let iSvc = "__all__", iIntv = "__all__";
  function initImpTable() {
    const svcs = [...new Set(IMP.issues.map(i => i.svc))].sort();
    $("#i-svc").innerHTML = '<option value="__all__">全部服务</option>' + svcs.map(s => `<option>${esc(s)}</option>`).join("");
    $("#i-intv").innerHTML = '<option value="__all__">全部干预</option>' + (IMP.plan || []).map(p => `<option value="${p.id}">${esc(p.id + " " + p.name.slice(0, 14))}</option>`).join("");
    $("#i-svc").addEventListener("change", e => { iSvc = e.target.value; drawImp(); });
    $("#i-intv").addEventListener("change", e => { iIntv = e.target.value; drawImp(); });
    drawImp();
  }
  function drawImp() {
    let rows = IMP.issues.slice();
    if (iSvc !== "__all__") rows = rows.filter(r => r.svc === iSvc);
    if (iIntv !== "__all__") rows = rows.filter(r => (r.intv || []).includes(iIntv));
    const sh = rows.reduce((a, r) => a + r.saved_h, 0);
    $("#i-cnt").textContent = `共 ${rows.length} 条 · 合计可省 ${Math.round(sh)}h`;
    const body = rows.map(r => `<tr>
      <td><a href="https://github.com/opensourceways/backlog/issues/${r.n}" target="_blank" rel="noopener">#${r.n}</a></td>
      <td style="color:var(--t2)">${esc(r.svc)}</td>
      <td style="text-align:center">${r.lines ?? "—"}</td><td style="text-align:center">${r.repos_changed ?? "—"}</td>
      <td style="text-align:center">${r.rounds} → <b style="color:#3ba272">${r.new_rounds}</b></td>
      <td style="text-align:center">${r.time_h}h → <b style="color:#3ba272">${r.new_time_h}h</b></td>
      <td style="text-align:center;font-weight:700;color:#c0392b">省 ${r.saved_h}h</td>
      <td>${(r.intv || []).join(" ")}</td></tr>`).join("");
    $("#itbl").innerHTML = `<thead><tr><th>#</th><th>服务</th><th>代码行</th><th>仓</th><th>轮次→预计</th><th>耗时→预计</th><th>可省</th><th>需做干预</th></tr></thead><tbody>${body}</tbody>`;
  }

  function renderKpis() {
    const failSum = Object.values(D.fail_stage || {}).reduce((a, b) => a + b, 0);
    const cards = [
      ["重点 issue", D.n_issues, "AI且≥7轮"],
      ["估算总耗时", D.total_hours + "h", "≈" + Math.round(D.total_hours / 8) + " 人日"],
      ["失败 Action", D.total_fail_actions, "含重试"],
      ["收敛率", Math.round(D.closed / D.n_issues * 100) + "%", D.closed + "/" + D.n_issues + " 完成"],
      ["未完成", D.n_issues - D.closed, "至今未closed"],
    ];
    $("#kpis").innerHTML = cards.map(([k, v, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}${s ? `<small>${s}</small>` : ""}</div></div>`).join("");
  }

  // TOP3 按根因合并
  function renderTop3() {
    const rw = D.rounds_weighted, tot = Object.values(rw).reduce((a, b) => a + b, 0);
    const g = codes => codes.reduce((a, c) => a + (rw[c] || 0), 0);
    const groups = [
      { color: "#ee6666", name: "AI 缺领域知识 → 实现不对", codes: ["OUTPUT_WRONG", "KNOWLEDGE_MISSING", "SKILL_MISSING", "CLAUDEMD_MISSING"],
        pts: ["AI 不知道表/接口/字段/仓库约定(哪张表、is_resolved 字段、清洗规则顺序、改仓库列表≠改 health.yaml)", "于是实现错、交占位符、污染无关子仓,人一轮轮喂口径纠正", "解法:把领域知识/同构复用索引/新增社区清单固化进 CLAUDE.md+skill+知识库"] },
      { color: "#fac858", name: "流水线 / 环境不稳", codes: ["PREVIEW_FAILED", "CI_GATE"],
        pts: ["预览 pod 起不来/CrashLoop/no-kubeconfig、AI 引擎 token 失效 rc=127、门禁(覆盖率/分支命名/trivy)反复红", "纯基础设施,与 AI 推理无关,却烧掉大量轮次(#926 force 30+次、#1309 极简功能连发十余次)", "解法:预览部署稳定性 + 引擎额度/鉴权可靠性 + 门禁与 AI 分支/环境兼容"] },
      { color: "#73c0de", name: "需求模糊 / 边做边加", codes: ["REQUIREMENT_VAGUE", "UI_NO_FEEDBACK", "DATA_MISSING"],
        pts: ["需求在预览阶段才逐版成形、单 issue 塞多模块、UI 要看到才提、预览无数据验不了", "解法:需求侧先拆分/定清验收口径,前端装视觉回灌,预览自动灌测试数据"] },
    ];
    $("#top3").innerHTML = groups.map((gr, i) => {
      const pct = Math.round(g(gr.codes) / tot * 100);
      return `<div class="t3" style="border-left-color:${gr.color}">
        <div class="rank">TOP ${i + 1}</div><div class="name">${gr.name}</div>
        <div class="pct">占消耗 <b style="color:${gr.color};font-size:18px">${pct}%</b></div>
        <ul>${gr.pts.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
    }).join("");
  }

  function renderCat() {
    const rw = D.rounds_weighted;
    const arr = Object.entries(rw).sort((a, b) => b[1] - a[1]);
    const tot = arr.reduce((a, x) => a + x[1], 0);
    ec("c-cat").setOption({
      grid: { left: 130, right: 50, top: 10, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: ${p[0].value}轮 (${(p[0].value / tot * 100).toFixed(0)}%)` },
      xAxis: { type: "value" }, yAxis: { type: "category", data: arr.map(x => D.cn[x[0]]).reverse() },
      series: [{ type: "bar", data: arr.map(x => ({ value: x[1], itemStyle: { color: CATCOLOR[x[0]] || "#888" } })).reverse(), barMaxWidth: 20, label: { show: true, position: "right", formatter: p => (p.value / tot * 100).toFixed(0) + "%" } }],
    });
  }

  function renderPrimary() {
    const codes = Object.keys(D.primary_by_n).sort((a, b) => D.primary_by_h[b] - D.primary_by_h[a]);
    ec("c-primary").setOption({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { bottom: 0 },
      grid: { left: 40, right: 20, top: 20, bottom: 60 },
      xAxis: { type: "category", data: codes.map(c => D.cn[c]), axisLabel: { interval: 0, rotate: 30, fontSize: 10 } },
      yAxis: [{ type: "value", name: "issue数" }, { type: "value", name: "小时" }],
      series: [
        { name: "issue数", type: "bar", data: codes.map(c => D.primary_by_n[c]), itemStyle: { color: "#5470c6" }, barMaxWidth: 26 },
        { name: "估耗时h", type: "line", yAxisIndex: 1, data: codes.map(c => D.primary_by_h[c]), itemStyle: { color: "#ee6666" }, smooth: true },
      ],
    });
  }

  function renderStage() {
    const sc = D.stage_cn || {}, sb = D.stage_bottleneck;
    const data = Object.entries(sb).map(([k, v]) => ({ name: sc[k] || k, value: v }));
    ec("c-stage").setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0, type: "scroll" },
      series: [{ type: "pie", radius: ["40%", "68%"], center: ["50%", "44%"], label: { formatter: "{b}\n{c}" },
        data: data.map(x => ({ ...x, itemStyle: { color: STAGECOLOR[x.name] || "#888" } })) }],
    });
  }

  function renderFailStage() {
    const fs = D.fail_stage || {};
    const arr = Object.entries(fs).sort((a, b) => b[1] - a[1]);
    $("#failN").textContent = arr.reduce((a, x) => a + x[1], 0);
    ec("c-failstage").setOption({
      grid: { left: 100, right: 40, top: 10, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value" }, yAxis: { type: "category", data: arr.map(x => x[0]).reverse() },
      series: [{ type: "bar", barMaxWidth: 22, data: arr.map(x => ({ value: x[1], itemStyle: { color: STAGECOLOR[x[0]] || "#888" } })).reverse(), label: { show: true, position: "right" } }],
    });
  }

  function renderSvc() {
    const svc = D.service.slice(0, 15).reverse();
    ec("c-svc").setOption({
      grid: { left: 150, right: 60, top: 10, bottom: 40 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => { const s = svc[p[0].dataIndex]; return `${s.svc}<br/>${s.n} 个 issue · ${s.h}h<br/>主问题: ${D.cn[s.primary]}`; } },
      xAxis: { type: "value", name: "估耗时(h)" }, yAxis: { type: "category", data: svc.map(s => s.svc) },
      series: [{ type: "bar", barMaxWidth: 20, data: svc.map(s => ({ value: s.h, itemStyle: { color: CATCOLOR[s.primary] || "#888" } })), label: { show: true, position: "right", formatter: p => svc[p.dataIndex].n + "个/" + p.value + "h" } }],
    });
    // 颜色图例说明
  }

  // ── 表格 ──
  let sortKey = "rounds", sortDir = -1, fSvc = "__all__", fPri = "__all__";
  function initTable() {
    const svcs = [...new Set(D.issues.map(i => i.service))].sort();
    $("#f-svc").innerHTML = '<option value="__all__">全部服务</option>' + svcs.map(s => `<option>${esc(s)}</option>`).join("");
    const pris = [...new Set(D.issues.map(i => i.primary))];
    $("#f-primary").innerHTML = '<option value="__all__">全部主问题</option>' + pris.map(p => `<option value="${p}">${esc(D.cn[p])}</option>`).join("");
    $("#f-svc").addEventListener("change", e => { fSvc = e.target.value; drawTable(); });
    $("#f-primary").addEventListener("change", e => { fPri = e.target.value; drawTable(); });
    drawTable();
  }
  const STAGE_CN2 = { "analyze-QA": "需求分析QA", "analyze": "需求分析", "preview": "开发预览", "submit": "开发提交", "deploy": "测试发布", "release": "发布上线", "engine": "AI引擎", "implement": "服务解析", "preview-push": "预览-推送" };
  function detailHTML(n) {
    const d = DET[String(n)]; if (!d) return '<div style="color:var(--t3)">无详情数据</div>';
    let h = `<div style="padding:10px 4px;line-height:1.75;font-size:13px">`;
    if (d.one_line) h += `<div><b>做什么:</b> ${esc(d.one_line)}</div>`;
    if (d.primary_desc) h += `<div><b>主问题:</b> ${esc(d.primary_desc)}</div>`;
    if (d.notable) h += `<div><b>特别注意:</b> ${esc(d.notable)}</div>`;
    if (d.cats && d.cats.length) {
      h += `<div style="margin-top:6px"><b>根因构成:</b><ul style="margin:4px 0 0;padding-left:20px">` +
        d.cats.map(c => `<li><span class="pill" style="background:${CATCOLOR[c.code] || "#888"};font-size:11px">${esc(D.cn[c.code] || c.code)}</span> ~${c.rounds ?? "?"}轮${c.ev ? ` — <span style="color:var(--t2)">${esc(c.ev)}</span>` : ""}</li>`).join("") + `</ul></div>`;
    }
    h += `<div style="margin-top:8px"><b>失败 Action(${d.fail_count} 条)</b>`;
    if (d.failures && d.failures.length) {
      h += `<table style="margin-top:4px;width:100%;font-size:12px"><thead><tr style="color:var(--t3)"><th style="padding:3px 6px">日期</th><th style="padding:3px 6px">阶段</th><th style="padding:3px 6px">失败原因</th><th style="padding:3px 6px">链接</th></tr></thead><tbody>` +
        d.failures.map(f => `<tr>
          <td style="padding:3px 6px;white-space:nowrap;color:var(--t3)">${esc(f.date || "")}</td>
          <td style="padding:3px 6px;white-space:nowrap">${esc(STAGE_CN2[f.stage] || f.stage || "")}</td>
          <td style="padding:3px 6px">${esc(f.reason || "")}</td>
          <td style="padding:3px 6px;white-space:nowrap">${f.run_url ? `<a href="${esc(f.run_url)}" target="_blank" rel="noopener">run ↗</a>` : "—"}</td>
        </tr>`).join("") + `</tbody></table>`;
    } else h += ` <span style="color:var(--t3)">(无失败 action 记录)</span>`;
    h += `</div><div style="margin-top:6px"><a href="https://github.com/opensourceways/backlog/issues/${n}" target="_blank" rel="noopener">→ 打开 issue #${n}(需权限)</a></div></div>`;
    return h;
  }

  function drawTable() {
    let rows = D.issues.slice();
    if (fSvc !== "__all__") rows = rows.filter(r => r.service === fSvc);
    if (fPri !== "__all__") rows = rows.filter(r => r.primary === fPri);
    rows.sort((a, b) => { const va = a[sortKey], vb = b[sortKey]; return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir; });
    $("#cnt").textContent = `共 ${rows.length} 条 · 点「详情」展开`;
    const cols = [["n", "#"], ["service", "服务"], ["type", "类型"], ["scenario", "场景"], ["rounds", "轮次"], ["lines", "代码行"], ["repos_changed", "仓"], ["time_h", "估h"], ["stage", "断点"], ["primary", "主问题"], ["fail_count", "失败Action"], ["succeeded", "完成"]];
    const th = cols.map(([k, l]) => `<th data-k="${k}">${l}${sortKey === k ? (sortDir < 0 ? " ▾" : " ▴") : ""}</th>`).join("") + `<th>详情</th>`;
    const body = rows.map(r => `<tr>
      <td><a href="https://github.com/opensourceways/backlog/issues/${r.n}" target="_blank" rel="noopener">#${r.n}</a></td>
      <td style="color:var(--t2)">${esc(r.service)}</td><td>${esc(r.type)}</td><td style="color:var(--t3)">${esc(r.scenario)}</td>
      <td style="font-weight:600">${r.rounds}</td><td style="text-align:center">${r.lines ?? "—"}</td><td style="text-align:center">${r.repos_changed ?? "—"}</td><td>${r.time_h}</td><td>${esc(D.stage_cn[r.stage] || r.stage)}</td>
      <td><span class="pill" style="background:${CATCOLOR[r.primary] || "#888"}">${esc(D.cn[r.primary])}</span></td>
      <td style="text-align:center">${r.fail_count || ""}</td>
      <td style="text-align:center">${r.succeeded ? "✅" : "⛔"}</td>
      <td><button class="det-btn" data-n="${r.n}" style="border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;color:var(--blue)">详情</button></td></tr>
      <tr class="det-row" id="det-${r.n}" style="display:none"><td colspan="13" style="background:#fafbfc">${""}</td></tr>`).join("");
    const t = $("#tbl"); t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`;
    t.querySelectorAll("th[data-k]").forEach(el => el.addEventListener("click", () => { const k = el.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; } drawTable(); }));
    t.querySelectorAll(".det-btn").forEach(b => b.addEventListener("click", () => {
      const n = b.dataset.n, row = $("#det-" + n);
      if (row.style.display === "none") { row.querySelector("td").innerHTML = detailHTML(n); row.style.display = ""; b.textContent = "收起"; }
      else { row.style.display = "none"; b.textContent = "详情"; }
    }));
  }
})();
