#!/usr/bin/env python3
"""管理员密码重置工具

安全说明：
  - 通用 X-Auth-Token 已下线，/sql 仅限管理员登录会话调用。
  - 运行前请设置环境变量（不要把密码写进文件）：
      JIT_NEW_ADMIN_PASSWORD  新密码
      JIT_ADMIN_SESSION       管理员登录后拿到的 session token
"""
import hashlib
import json
import os
import urllib.request
import datetime

SALT = "yuguo-jr-salt-2024"
PASSWORD = os.environ.get("JIT_NEW_ADMIN_PASSWORD", "")
SESSION = os.environ.get("JIT_ADMIN_SESSION", "")
PROXY_URL = "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run"

if not PASSWORD or not SESSION:
    raise SystemExit("请先设置 JIT_NEW_ADMIN_PASSWORD 和 JIT_ADMIN_SESSION 环境变量")

# 管理员登录使用原始 SHA-256（无 sha256$ 前缀）
sha256_hash = hashlib.sha256((SALT + PASSWORD).encode()).hexdigest()
print("SHA-256:", sha256_hash)

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
sql = "UPDATE users SET password_hash=?, updated_at=? WHERE id=?"
params = [sha256_hash, now, "admin"]

body = json.dumps({"sql": sql, "params": params}).encode("utf-8")
req = urllib.request.Request(
    PROXY_URL + "/sql",
    data=body,
    headers={
        "Content-Type": "application/json",
        "X-Session-Token": SESSION,
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        print("成功:", resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode("utf-8", errors="replace")[:500])
except Exception as e:
    print("错误:", e)
