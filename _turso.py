import urllib.request, json, os, sys
url = os.environ["TURSO_URL"]
token = os.environ["TURSO_TK"]
sql = sys.argv[1]
body = json.dumps({"requests": [{"type": "execute", "stmt": {"sql": sql}}]}).encode()
req = urllib.request.Request(url, body, {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
data = json.loads(urllib.request.urlopen(req).read())
err = (data.get("results") or [{}])[0].get("error")
if err:
    print("FAIL:", err["message"])
else:
    rows = (data.get("results") or [{}])[0].get("response", {}).get("result", {}).get("rows", [])
    print("OK, rows:", len(rows))
    for r in rows[:5]:
        print([c.get("value", c) if isinstance(c, dict) else c for c in r])