# -*- coding: utf-8 -*-
"""生成 backlog 全量 issue 洞察数据 backlog-insights.json。

数据源：opensourceways/backlog 全部 issue（不限 project），创建时间 >= SINCE。

**极省 API**：用 GraphQL search 一次翻页拉回 issue + 内嵌评论(first:100)，
整个流程约 ~12 次调用（每页 50 个 issue，每 issue 内嵌前 100 条评论）；
只有极少数评论 > 100 的 issue 才追加分页。相比逐页 REST 评论（100+ 次）大幅省配额。

维度：
  - 类型（需求 / 缺陷 / 任务 / CVE / 其他）
  - 状态（open / closed）
  - 按月（创建月 / 关闭月）
  - 是否 AI 需求：`需求` 且有「非机器人」评论过 /ai-develop-preview
  - 归属服务：label 里的 target:xxx（优先）或 project:xxx
  - AI 交互轮次：非机器人评论触发各阶段命令的次数
      分析     = /ai-requirement-analysis
      实现     = /ai-develop-preview
      上线测试 = /ai-deploy-test
      发布正式 = /ai-release-plan

token 从环境变量 BACKLOG_TOKEN / GH_TOKEN 读取，不落盘、不硬编码。
"""
import json, os, re, sys, datetime, time
import urllib.request as u
import urllib.error

TOKEN = os.environ.get("BACKLOG_TOKEN") or os.environ.get("GH_TOKEN") or ""
if not TOKEN:
    print("ERROR: 缺少 BACKLOG_TOKEN / GH_TOKEN 环境变量", file=sys.stderr)
    sys.exit(1)

REPO = "opensourceways/backlog"
SINCE = os.environ.get("INSIGHT_SINCE", "2026-01-01")
OUT = os.environ.get("INSIGHT_OUT", "backlog-insights.json")

ROBOTS = {"flysky22222", "3333", "github-actions", "github-actions[bot]"}

# 交互轮次以「机器人流程进度评论」为准（accepted 后需求分析/实现是自动触发的，
# 只数人工 /命令 会严重漏算）。机器人每次某阶段启动都会发一条流程行，如：
#   > **流程**: `🟢 [1] 需求分析`  ➜  `⚪ [2] 开发预览`  ➜  `⚪ [3] 开发提交`  ➜  `⚪ [4] 测试发布`  ➜  `⚪ [5] 正式上线`
# 🟢 = 该阶段本轮启动，✅ = 已完成（会在后续每条里持续显示，不能计数），⚪ = 未开始。
# 数每条评论里的 🟢[N] 即该阶段被启动（=一轮）的真实次数。
STAGES = [("analyze", ""), ("implement", ""), ("deploy", ""), ("release", "")]
STAGE_LABEL = {"analyze": "需求分析", "implement": "开发(预览+提交)", "deploy": "测试发布", "release": "正式上线"}
# 机器人 5 阶段 → 本表 4 桶：开发预览[2]+开发提交[3] 合并为「实现」
IDX_STAGE = {1: "analyze", 2: "implement", 3: "implement", 4: "deploy", 5: "release"}
MARK_RE = re.compile(r"\U0001F7E2\s*\[(\d)\]")   # 🟢 [N]

SEARCH = f'repo:{REPO} is:issue created:>={SINCE}'
QUERY = """
query($q:String!,$after:String){
  search(query:$q, type:ISSUE, first:50, after:$after){
    issueCount
    pageInfo{ hasNextPage endCursor }
    nodes{
      __typename
      ... on Issue{
        number title state createdAt closedAt
        author{ login }
        labels(first:30){ nodes{ name } }
        comments(first:100){
          totalCount
          pageInfo{ hasNextPage endCursor }
          nodes{ author{ login } body }
        }
      }
    }
  }
}
"""
# 追加分页：评论 > 100 的极少数 issue
MORE_COMMENTS = """
query($number:Int!,$after:String){
  repository(owner:"opensourceways", name:"backlog"){
    issue(number:$number){
      comments(first:100, after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{ author{ login } body }
      }
    }
  }
}
"""


def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = u.Request("https://api.github.com/graphql", data=body, headers={
        "User-Agent": "datastat-insights-bot",
        "Authorization": f"bearer {TOKEN}",
        "Content-Type": "application/json",
    })
    last = None
    for _ in range(4):
        try:
            r = json.load(u.urlopen(req, timeout=90))
            if r.get("errors"):
                print("GraphQL errors:", json.dumps(r["errors"])[:300], file=sys.stderr)
            return r
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 502):
                time.sleep(5); last = e; continue
            print("HTTPError", e.code, e.read()[:200].decode("utf-8", "ignore"), file=sys.stderr)
            return {}
        except Exception as ex:
            last = ex; time.sleep(2)
    print("network error", last, file=sys.stderr)
    return {}


def issue_type(title, labels):
    t_low = (title or "").lower()
    lab_low = [l.lower() for l in labels]
    if any("cve" in l for l in lab_low) or re.search(r"cve-\d", t_low):
        return "CVE"
    m = re.match(r"\s*[\[【]([^\]】]+)[\]】]", title or "")
    prefix = (m.group(1).strip() if m else "")
    if "需求" in prefix or "feature" in " ".join(lab_low):
        return "需求"
    if "缺陷" in prefix or "bug" in prefix.lower() or "bug" in lab_low:
        return "缺陷"
    if "任务" in prefix or "task" in lab_low:
        return "任务"
    if "需求" in t_low:
        return "需求"
    return "其他"


def service_of(labels):
    tgt = [l[len("target:"):] for l in labels if l.startswith("target:")]
    if tgt:
        return tgt[0]
    proj = [l[len("project:"):] for l in labels if l.startswith("project:")]
    if proj:
        return proj[0]
    return "未分服务"


# 场景（任务性质）派生：按标题关键词 + 类型 + 服务名归类，供「场景成熟度」分析用
SCENARIO_RULES = [
    ("安全/CVE",   ["cve", "漏洞", "security", "安全", "trivy"]),
    ("机器人/自动化", ["机器人", "robot", "自动回复", "论坛回复", "reply", "bot", "自动化", "webhook", "hook"]),
    ("前端看板/UI",  ["看板", "前端", "页面", "图表", "雷达", "dashboard", "ui", "展示", "vue", "table", "卡片", "筛选", "导出", "洞察页"]),
    ("数据/指标",   ["采集", "清洗", "数据", "pipeline", "入库", "同步", "dws", "dwm", "fact", "指标", "统计", "计算", "报表", "sql", "etl", "dataarts"]),
    ("CI/部署",    ["ci", "流水线", "构建", "部署", "发布", "workflow", "runner", "门禁", "镜像", "argocd", "deploy", "release"]),
    ("接口/API",   ["接口", "api", "查询", "magicapi", ".ms", "endpoint"]),
    ("会议",      ["会议", "meeting", "会务"]),
    ("文档/流程",   ["文档", "doc", "规范", "流程", "readme", "说明书"]),
]


def scenario_of(title, itype, service):
    if itype == "CVE":
        return "安全/CVE"
    t = (title or "").lower()
    svc = (service or "").lower()
    hay = t + " " + svc
    for name, kws in SCENARIO_RULES:
        if any(k in hay for k in kws):
            return name
    return "其他/未分"


def month(dstr):
    return dstr[:7] if dstr else None


def tally(rec, comment_nodes):
    """按机器人流程评论里的 🟢[N] 标记计每阶段启动轮次（一条评论同阶段只计 1）。"""
    for c in comment_nodes:
        body = c.get("body") or ""
        idxs = set(MARK_RE.findall(body))
        if idxs:
            rec["hasFlow"] = True
        for i in idxs:
            k = IDX_STAGE.get(int(i))
            if k:
                rec["rounds"][k] += 1
                if k == "implement":
                    rec["aiCmd"] = True


# ── 拉取 issue + 内嵌评论 ──
issues = {}
overflow = []   # (number, endCursor) 评论 > 100 的 issue
after = None
calls = 0
while True:
    r = gql(QUERY, {"q": SEARCH, "after": after})
    calls += 1
    s = (r.get("data") or {}).get("search")
    if not s:
        print("ERROR: 查询失败", json.dumps(r)[:300], file=sys.stderr)
        sys.exit(1)
    for it in s["nodes"]:
        if it.get("__typename") != "Issue":
            continue
        labels = [l["name"] for l in (it.get("labels") or {}).get("nodes", [])]
        num = it["number"]
        created = (it.get("createdAt") or "")[:10]
        _title = it.get("title", "")
        _type = issue_type(_title, labels)
        rec = {
            "n": num,
            "title": _title,
            "type": _type,
            "scenario": scenario_of(_title, _type, service_of(labels)),
            "state": (it.get("state") or "OPEN").lower(),
            "created": created,
            "createdMonth": month(created),
            "closed": (it.get("closedAt") or "")[:10] or None,
            "closedMonth": month((it.get("closedAt") or "")[:10]),
            "service": service_of(labels),
            "author": (it.get("author") or {}).get("login"),
            "aiCmd": False,
            "hasFlow": False,
            "rounds": {k: 0 for k, _ in STAGES},
        }
        cm = it.get("comments") or {}
        tally(rec, cm.get("nodes", []))
        if (cm.get("pageInfo") or {}).get("hasNextPage"):
            overflow.append((num, cm["pageInfo"]["endCursor"]))
        issues[num] = rec
    print(f"search page {calls}: 累计 {len(issues)} / {s.get('issueCount')} 条", file=sys.stderr)
    if s["pageInfo"]["hasNextPage"]:
        after = s["pageInfo"]["endCursor"]
    else:
        break

# ── 追加分页评论 > 100 的少数 issue ──
for num, cur in overflow:
    while cur:
        r = gql(MORE_COMMENTS, {"number": num, "after": cur})
        calls += 1
        cm = (((r.get("data") or {}).get("repository") or {}).get("issue") or {}).get("comments") or {}
        tally(issues[num], cm.get("nodes", []))
        pi = cm.get("pageInfo") or {}
        cur = pi["endCursor"] if pi.get("hasNextPage") else None

# ── 组装 records ──
recs = []
for rec in issues.values():
    rec["roundsTotal"] = sum(rec["rounds"].values())
    rec["ai"] = (rec["type"] == "需求" and rec["aiCmd"])
    rec.pop("aiCmd", None)
    recs.append(rec)
recs.sort(key=lambda r: r["n"], reverse=True)

# 去敏（公开页面）：不输出 issue 标题 / 提交人账号（私有仓 opensourceways/backlog 的内容），
# 只保留聚合分析所需字段 + issue 编号（编号对外网是 404，仅有权限者能点开核对）。
for rec in recs:
    rec.pop("title", None)
    rec.pop("author", None)
    rec.pop("hasFlow", None)

now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
out = {
    "generatedAt": now.strftime("%Y-%m-%d %H:%M"),
    "source": REPO,
    "since": SINCE,
    "total": len(recs),
    "stages": [{"key": k, "label": STAGE_LABEL[k]} for k, _ in STAGES],
    "roundSource": "机器人流程评论 🟢[N] 阶段启动标记（含 accepted 自动触发，非仅 /命令）",
    "records": recs,
}

old = {}
if os.path.exists(OUT):
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
if old.get("records") == recs:
    print(f"记录无变化（{len(recs)} 条），保持文件不变")
    sys.exit(0)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

from collections import Counter
print(f"OK 写入 {OUT}：{len(recs)} 条 issue；GraphQL 调用 {calls} 次")
print("按类型:", dict(Counter(r["type"] for r in recs)))
print("按状态:", dict(Counter(r["state"] for r in recs)))
print("AI 需求:", sum(1 for r in recs if r["ai"]))
print("有交互轮次的 issue:", sum(1 for r in recs if r["roundsTotal"] > 0))
