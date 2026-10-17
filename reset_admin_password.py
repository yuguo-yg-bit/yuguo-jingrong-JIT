#!/usr/bin/env python3
"""一键重置管理员密码为 27015150111"""
import hashlib
import json
import urllib.request
import datetime

SALT = "yuguo-jr-salt-2024"
PASSWORD = "27015150111"
PROXY_URL = "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run"
AUTH_TOKEN = "Jrb@025808"

# 计算哈希
hash_input = SALT + PASSWORD
sha256_hash = hashlib.sha256(hash_input.encode()).hexdigest()
print(f"密码: {PASSWORD}")
print(f"加盐输入: {hash_input}")
print(f"SHA-256: {sha256_hash}")

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

# 更新数据库
sql = "UPDATE users SET password_hash=?, updated_at=? WHERE id=?"
params = [sha256_hash, now, "admin"]

body = json.dumps({"sql": sql, "params": params}).encode("utf-8")
req = urllib.request.Request(
    PROXY_URL + "/sql",
    data=body,
    headers={
        "Content-Type": "application/json",
        "X-Auth-Token": AUTH_TOKEN
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        result = resp.read().decode("utf-8")
        print(f"✅ 成功! 响应: {result}")
        print(f"\n管理员密码已重置为: {PASSWORD}")
except urllib.error.HTTPError as e:
    body_text = e.read().decode("utf-8", errors="replace")
    print(f"❌ HTTP {e.code}: {body_text[:500]}")
except Exception as e:
    print(f"❌ 错误: {e}")