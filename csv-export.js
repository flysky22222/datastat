// 通用「导出 CSV」——自动给页面上每个 echarts 图表 + 每个 table 加一个导出按钮。
// 点击时读取「当前」数据(表格按当前筛选后的行、图表按当前 option),导出带 BOM 的 UTF-8 CSV(Excel 可直接开)。
(() => {
  "use strict";
  const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const esc = (s) => {
    s = String(s == null ? "" : s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const toCsv = (rows) => "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const today = () => {
    try { return new Date().toISOString().slice(0, 10); } catch (e) { return "data"; }
  };
  const dl = (name, csv) => {
    const b = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 200);
  };
  const nameFor = (el) => {
    const card = el.closest(".card");
    const h = card && card.querySelector("h3");
    let base = (h ? txt(h) : document.title || "data").slice(0, 40).replace(/[\/\\:*?"<>|,]/g, "");
    return (base || "data") + "-" + today() + ".csv";
  };

  const tableToRows = (table) => {
    const heads = [...table.querySelectorAll("thead tr")];
    const hr = heads.find((r) => !r.querySelector("input,select")) || heads[0];
    const rows = [];
    if (hr) rows.push([...hr.children].map(txt));
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const cells = [...tr.children];
      // 跳过展开的详情整行(单个 colspan 大格),避免污染列对齐
      if (cells.length === 1 && cells[0].getAttribute("colspan")) return;
      rows.push(cells.map(txt));
    });
    return rows;
  };

  const chartToRows = (inst) => {
    let opt; try { opt = inst.getOption(); } catch (e) { return null; }
    const series = opt.series || [];
    if (!series.length) return null;
    const t = series[0].type;
    if (t === "pie") {
      const rows = [["名称", "值"]];
      (series[0].data || []).forEach((d) => rows.push([d && d.name != null ? d.name : "", d && d.value != null ? d.value : d]));
      return rows;
    }
    if (t === "scatter") {
      const rows = [["x", "y", "size"]];
      series.forEach((s) => (s.data || []).forEach((d) => {
        const v = (d && d.value) || d || [];
        rows.push([v[0], v[1], v[2] != null ? v[2] : ""]);
      }));
      return rows;
    }
    // bar / line：找 category 轴 + 每个 series 一列
    const findCat = (ax) => (Array.isArray(ax) ? ax : [ax]).find((a) => a && a.type === "category");
    const cax = findCat(opt.xAxis) || findCat(opt.yAxis) || {};
    const cats = cax.data || [];
    const cell = (s, i) => {
      const d = (s.data || [])[i];
      return d && typeof d === "object" ? (d.value != null ? d.value : "") : (d != null ? d : "");
    };
    const rows = [["类别", ...series.map((s) => s.name || "值")]];
    cats.forEach((c, i) => rows.push([c, ...series.map((s) => cell(s, i))]));
    return rows;
  };

  const mkBtn = (onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "csv-dl-btn";
    b.textContent = "⬇ 导出CSV";
    b.title = "导出当前数据为 CSV(Excel 可直接打开)";
    b.addEventListener("click", onClick);
    return b;
  };
  const place = (el, b) => {
    const card = el.closest(".card");
    if (card) { card.style.position = card.style.position || "relative"; card.insertBefore(b, card.firstChild); }
    else el.parentNode.insertBefore(b, el);
  };

  function scan() {
    // 表格
    document.querySelectorAll("table").forEach((tbl) => {
      if (tbl.dataset.csv) return;
      tbl.dataset.csv = "1";
      place(tbl, mkBtn(() => dl(nameFor(tbl), toCsv(tableToRows(tbl)))));
    });
    // 图表(echarts 实例挂在具体 div 上)
    if (window.echarts) {
      document.querySelectorAll('.chart,[id^="c-"]').forEach((d) => {
        if (d.dataset.csv) return;
        const inst = echarts.getInstanceByDom(d);
        if (!inst) return;
        d.dataset.csv = "1";
        place(d, mkBtn(() => { const r = chartToRows(inst); if (r && r.length > 1) dl(nameFor(d), toCsv(r)); else alert("该图暂无可导出的结构化数据"); }));
      });
    }
  }

  const style = document.createElement("style");
  style.textContent =
    ".csv-dl-btn{position:absolute;top:10px;right:12px;z-index:5;font-size:12px;padding:3px 10px;" +
    "border:1px solid rgba(0,0,0,.15);border-radius:6px;background:#fff;color:#002fa7;cursor:pointer;" +
    "box-shadow:0 1px 2px rgba(0,0,0,.06)}.csv-dl-btn:hover{background:#eef1fb;border-color:#002fa7}";
  (document.head || document.documentElement).appendChild(style);

  // 图表/表格是异步渲染的，轮询扫几轮把新出现的都补上
  let n = 0;
  const timer = setInterval(() => { scan(); if (++n > 15) clearInterval(timer); }, 700);
  document.addEventListener("DOMContentLoaded", scan);
  window.addEventListener("load", scan);
  window.CSVExport = { scan };
})();
