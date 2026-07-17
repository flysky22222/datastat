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
