# -*- coding: utf-8 -*-
"""生成数据中台需求看板数据 data.json。

数据源：opensourceways/backlog 中 label=project:om-datacenter 的全部 issue。
为尽量少打 GitHub API（有速率限制），整个流程**只发 1 次 GraphQL 请求**，
一次性把 issue 基本信息 + issue 级 Fields(优先级/计划完成时间) + 交付看板成员关系全拉回来。

token 从环境变量 BACKLOG_TOKEN 读取（CI 中由 GitHub Secret 注入），不落盘、不硬编码。
"""
import json, os, re, sys, datetime
import urllib.request as u
import urllib.error

TOKEN = os.environ.get("BACKLOG_TOKEN") or os.environ.get("GH_TOKEN") or ""
if not TOKEN:
    print("ERROR: 缺少 BACKLOG_TOKEN 环境变量", file=sys.stderr)
    sys.exit(1)

LABEL = "project:om-datacenter"
OUT = os.environ.get("DATA_OUT", "data.json")

SEARCH = f'repo:opensourceways/backlog label:"{LABEL}"'
QUERY = """
query($q:String!,$after:String){
  search(query:$q, type:ISSUE, first:100, after:$after){
    issueCount
    pageInfo{ hasNextPage endCursor }
    nodes{
      __typename
      ... on Issue{
        number title url state stateReason createdAt updatedAt closedAt
        author{ login }
        comments{ totalCount }
        assignees(first:10){ nodes{ login } }
        labels(first:30){ nodes{ name } }
        issueFieldValues(first:30){ nodes{
          __typename
          ... on IssueFieldSingleSelectValue{ name field{ ... on IssueFieldSingleSelect{ name } } }
          ... on IssueFieldDateValue{ value field{ ... on IssueFieldDate{ name } } }
        } }
        projectItems(first:10){ nodes{ project{ title } } }
      }
    }
  }
}
"""

def gql(after=None):
    body = json.dumps({"query": QUERY, "variables": {"q": SEARCH, "after": after}}).encode()
    req = u.Request("https://api.github.com/graphql", data=body, headers={
        "User-Agent": "datastat-bot",
        "Authorization": f"bearer {TOKEN}",
        "GraphQL-Features": "issue_types,issue_fields",
        "Content-Type": "application/json",
    })
    for _ in range(3):
        try:
            return json.load(u.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            print("HTTPError", e.code, e.read()[:300].decode("utf-8", "ignore"), file=sys.stderr)
            return {}
        except Exception as ex:
            last = ex
    print("network error", last, file=sys.stderr)
    return {}

def derive_status(state, reason):
    if state == "OPEN":
        return "open"
    return "merged" if reason == "COMPLETED" else "closed"

def issue_type(title):
    m = re.match(r"\s*[\[【]([^\]】]+)[\]】]", title or "")
    t = (m.group(1).strip() if m else "")
    if "需求" in t: return "需求"
    if "缺陷" in t or "bug" in t.lower(): return "缺陷"
    if "任务" in t: return "任务"
    return "其他"

def clean_title(title):
    return re.sub(r"^\s*[\[【][^\]】]+[\]】]\s*", "", title or "").strip() or (title or "").strip()

def planned_from_board(t):
    m = re.match(r"(\d{2})(\d{2})交付看板", t or "")
    return f"2026-{m.group(1)}-{m.group(2)}" if m else None

# ── 拉取（单次，必要时翻页；45 条一页就够）──
nodes, after = [], None
calls = 0
while True:
    r = gql(after)
    calls += 1
    s = (r.get("data") or {}).get("search")
    if not s:
        print("ERROR: 查询失败", json.dumps(r)[:300], file=sys.stderr)
        sys.exit(1)
    nodes += [n for n in s["nodes"] if n.get("__typename") == "Issue"]
    if s["pageInfo"]["hasNextPage"]:
        after = s["pageInfo"]["endCursor"]
    else:
        break

recs = []
for it in nodes:
    asg = [a["login"] for a in (it.get("assignees") or {}).get("nodes", [])]
    labels = [l["name"] for l in (it.get("labels") or {}).get("nodes", []) if not l["name"].startswith("project:")]
    pv, tgt = "", ""
    for fv in (it.get("issueFieldValues") or {}).get("nodes", []):
        fn = ((fv.get("field") or {}).get("name") or "").lower()
        if fn == "priority" and fv.get("name"):
            pv = fv["name"]
        elif fn in ("target date", "计划完成时间") and fv.get("value"):
            tgt = str(fv["value"])[:10]
    plans = [planned_from_board(pi["project"]["title"]) for pi in (it.get("projectItems") or {}).get("nodes", [])]
    plans = [p for p in plans if p]
    recs.append({
        "number": it["number"],
        "title": clean_title(it["title"]),
        "rawTitle": it["title"],
        "url": it["url"],
        "status": derive_status(it["state"], it.get("stateReason")),
        "state": it["state"].lower(),
        "stateReason": (it.get("stateReason") or "").lower() or None,
        "type": issue_type(it["title"]),
        "assignees": asg,
        "author": (it.get("author") or {}).get("login"),
        "labels": labels,
        "comments": (it.get("comments") or {}).get("totalCount", 0),
        "createdAt": (it.get("createdAt") or "")[:10],
        "updatedAt": (it.get("updatedAt") or "")[:10],
        "closedAt": (it.get("closedAt") or "")[:10],
        "priority": pv,
        "plannedAt": tgt or (min(plans) if plans else ""),
    })

order = {"open": 0, "merged": 1, "closed": 2}
recs.sort(key=lambda r: (order.get(r["status"], 3), r["createdAt"]))
recs.sort(key=lambda r: r["createdAt"], reverse=True)
recs.sort(key=lambda r: order.get(r["status"], 3))

# 记录内容无变化则不改文件（保留旧 generatedAt），避免定时跑出现无意义提交
old = {}
if os.path.exists(OUT):
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
if old.get("records") == recs:
    print(f"记录无变化（{len(recs)} 条），保持文件不变，不提交")
    sys.exit(0)

# 生成时间用北京时间(UTC+8)
now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
out = {
    "generatedAt": now.strftime("%Y-%m-%d %H:%M"),
    "source": "opensourceways/backlog",
    "label": LABEL,
    "total": len(recs),
    "records": recs,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

from collections import Counter
print(f"OK 写入 {OUT}：{len(recs)} 条；GraphQL 调用 {calls} 次")
print("status", dict(Counter(r["status"] for r in recs)))
print("priority", dict(Counter(r["priority"] or "(空)" for r in recs)))
print("plannedAt", dict(Counter(r["plannedAt"] or "(空)" for r in recs)))
