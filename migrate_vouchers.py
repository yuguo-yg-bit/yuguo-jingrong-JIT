#!/usr/bin/env python3
"""将 GitHub Issues 中的凭证数据迁移到 Turso/libsql 数据库"""

import requests
import re
import time
import sys
import json

import os

# ========== 配置 ==========
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_API = "https://api.github.com"
REPO_OWNER = "yuguo-yg-bit"
REPO_NAME = "yuguo-jingrong-JIT"

TURSO_PROXY = "https://yuguoygbit--efeee912c58011f1af2f1607ee4eb77e.web.val.run"
TURSO_AUTH = "Jrb@025808"

VOUCHER_LABEL = "voucher"

# ========== GitHub API 调用 ==========
def gh_get(path, params=None):
    url = f"{GITHUB_API}/repos/{REPO_OWNER}/{REPO_NAME}{path}"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "VoucherMigration/1.0"
    }
    resp = requests.get(url, headers=headers, params=params)
    resp.raise_for_status()
    return resp

def gh_get_all_pages(path, params=None):
    """分页获取所有结果"""
    params = dict(params or {})
    params["per_page"] = 100
    params["page"] = 1
    all_items = []
    while True:
        resp = gh_get(path, params)
        items = resp.json()
        if not items:
            break
        all_items.extend(items)
        if len(items) < 100:
            break
        params["page"] += 1
        time.sleep(0.5)
    return all_items

# ========== 解析 GitHub Issue Body（与 _parseIssueBody 逻辑一致） ==========
def parse_issue_body(body):
    data = {}
    lines = str(body or "").split("\n")

    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue

        m = re.match(r"^｜?标题：(.+)$", trimmed)
        if m:
            data["title"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*用户ID：(.+)$", trimmed)
        if m:
            data["userId"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?内容：店铺：(.+)$", trimmed)
        if m:
            data["shopName"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*店铺照片：(.+)$", trimmed)
        if m:
            data["shopPhoto"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*商品订单照片：(.+)$", trimmed)
        if m:
            data["orderPhotos"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*定位：(.+)$", trimmed)
        if m:
            loc = m.group(1).strip()
            parts = loc.split(",")
            data["latitude"] = parts[0] if len(parts) > 0 else ""
            data["longitude"] = parts[1] if len(parts) > 1 else ""
            continue

        m = re.match(r"^｜?\s*金额：(.+)$", trimmed)
        if m:
            data["amount"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*签名：(.+)$", trimmed)
        if m:
            data["signature"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*备注：(.+)$", trimmed)
        if m:
            data["remark"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*创建时间：(.+)$", trimmed)
        if m:
            data["date"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*状态：(.+)$", trimmed)
        if m:
            data["status"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*中奖打折：(.+)$", trimmed)
        if m:
            data["discount"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*支付方式：(.+)$", trimmed)
        if m:
            data["paymentMethod"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*不通过原因：(.+)$", trimmed)
        if m:
            data["rejectReason"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*凭证类型：(.+)$", trimmed)
        if m:
            data["voucherType"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*购物平台：(.+)$", trimmed)
        if m:
            data["platform"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*订单号：(.+)$", trimmed)
        if m:
            data["orderNo"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*商品截图：(.+)$", trimmed)
        if m:
            data["productPhoto"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*购物截图：(.+)$", trimmed)
        if m:
            data["shoppingPhotos"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*模式标识：(.+)$", trimmed)
        if m:
            s = m.group(1).strip()
            if "电器补贴" in s:
                data["electric"] = True
            continue

        m = re.match(r"^｜?\s*电器分类：(.+)$", trimmed)
        if m:
            data["electricCategory"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*品牌名称：(.+)$", trimmed)
        if m:
            data["electricBrand"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*申请基数金额：(.+)$", trimmed)
        if m:
            data["electricApplyAmount"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*补贴比例：(.+)$", trimmed)
        if m:
            data["electricSubsidyRate"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*补贴金额：(.+)$", trimmed)
        if m:
            data["electricSubsidyAmount"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*审核结果：(.+)$", trimmed)
        if m:
            data["reviewResult"] = m.group(1).strip()
            continue

        m = re.match(r"^｜?\s*最终实付：(.+)$", trimmed)
        if m:
            data["finalPrice"] = m.group(1).strip()
            if not data.get("discount"):
                data["discount"] = "补贴模式"
            continue

    # 从标题提取 voucherId
    title = data.get("title", "")
    if title:
        m = re.search(r"(\d+)$", title)
        if m:
            data["voucherId"] = m.group(1)

    return data


# ========== 金额解析 ==========
def parse_amount(amount_str):
    """从 "99.50元" 提取 99.5"""
    if not amount_str:
        return 0
    m = re.search(r"[\d,.]+", str(amount_str))
    if m:
        return float(m.group().replace(",", ""))
    return 0


# ========== Turso 代理调用 ==========
def turso_sql(sql, params=None):
    """通过 Val.town 代理执行 Turso SQL"""
    body = {"sql": sql, "params": params or []}
    resp = requests.post(
        f"{TURSO_PROXY}/sql",
        headers={
            "Content-Type": "application/json",
            "X-Auth-Token": TURSO_AUTH,
        },
        json=body,
        timeout=30
    )
    resp.raise_for_status()
    return resp.json()


# ========== 主迁移逻辑 ==========
def main():
    # 检查 GitHub Token（通过环境变量 GITHUB_TOKEN 传入）
    if not GITHUB_TOKEN:
        print("错误：请设置 GITHUB_TOKEN 环境变量")
        print("用法：GITHUB_TOKEN=ghp_xxx python3 migrate_vouchers.py")
        sys.exit(1)

    print("=" * 60)
    print("凭证迁移：GitHub Issues → Turso/libsql")
    print("=" * 60)

    # 1. 获取所有带 voucher 标签的 Issues
    print("\n[1] 获取 GitHub Issues（voucher 标签）...")
    issues = gh_get_all_pages("/issues", {
        "labels": VOUCHER_LABEL,
        "state": "all",
        "sort": "created",
        "direction": "asc"
    })
    print(f"    找到 {len(issues)} 个凭证 Issue")

    if not issues:
        print("    没有凭证需要迁移！")
        return

    # 2. 过滤纯 Pull Request（GitHub Issues API 会混入 PR）
    voucher_issues = [i for i in issues if "pull_request" not in i]
    print(f"    过滤 PR 后：{len(voucher_issues)} 个")

    # 3. 解析并构建 INSERT
    print("\n[2] 解析 Issue body 并写入 Turso...")
    success_count = 0
    skip_count = 0
    fail_count = 0

    for idx, issue in enumerate(voucher_issues):
        parsed = parse_issue_body(issue.get("body", ""))
        labels = [l["name"] for l in issue.get("labels", [])]

        # 确定 id：优先用 voucherId（标题里的数字），否则用 GitHub issue number
        voucher_id = parsed.get("voucherId", "")
        if not voucher_id:
            voucher_id = str(issue["number"])

        # 用户ID
        user_id = parsed.get("userId", "")
        if not user_id:
            title = parsed.get("title", issue.get("title", ""))
            user_id = re.sub(r"\d+$", "", title).strip()

        # 状态映射
        status = parsed.get("status", "待审核")
        # 如果已有 labels 标记
        if "completed" in labels:
            status = "已完成交易"
        elif "paid" in labels:
            status = "已付款·待确认"
        elif "approved" in labels:
            status = "approved"
        elif "rejected" in labels:
            status = "rejected"

        # 支付状态
        payment_status = "待支付"
        if "paid" in labels:
            payment_status = "paid"

        # 金额解析
        amount_val = parse_amount(parsed.get("amount", "0"))
        electric_apply = parse_amount(parsed.get("electricApplyAmount", "0"))
        electric_subsidy = parse_amount(parsed.get("electricSubsidyAmount", "0"))

        # order_type
        order_type = parsed.get("voucherType", "普通凭证")

        try:
            sql = """INSERT INTO vouchers (id, user_id, order_type, shop_name, shop_photo, order_photos,
                     latitude, longitude, amount, discount, discounted_amount, status, payment_status,
                     payment_method, remark, signature, reject_reason, platform, order_no, product_photo,
                     shopping_photos, electric_category, electric_brand, electric_apply_amount,
                     electric_subsidy_rate, electric_subsidy_amount, review_result, final_price,
                     created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""

            params = [
                voucher_id,
                user_id,
                order_type,
                parsed.get("shopName", "") or "",
                parsed.get("shopPhoto", "") or "",
                parsed.get("orderPhotos", "") or "",
                parsed.get("latitude", "") or "",
                parsed.get("longitude", "") or "",
                amount_val,
                parsed.get("discount", "") or "",
                0,  # discounted_amount
                status,
                payment_status,
                parsed.get("paymentMethod", "") or "",
                parsed.get("remark", "") or "",
                parsed.get("signature", "") or "",
                parsed.get("rejectReason", "") or "",
                parsed.get("platform", "") or "",
                parsed.get("orderNo", "") or "",
                parsed.get("productPhoto", "") or "",
                parsed.get("shoppingPhotos", "") or "",
                parsed.get("electricCategory", "") or "",
                parsed.get("electricBrand", "") or "",
                electric_apply,
                parsed.get("electricSubsidyRate", "") or "",
                electric_subsidy,
                parsed.get("reviewResult", "") or "",
                parsed.get("finalPrice", "") or "",
                issue.get("created_at", ""),
                issue.get("updated_at", ""),
            ]

            result = turso_sql(sql, params)
            if result.get("ok"):
                success_count += 1
                shop = parsed.get("shopName", "?")
                print(f"    [{idx+1}/{len(voucher_issues)}] ✅ #{voucher_id} {shop} ({user_id})")
            else:
                fail_count += 1
                err_msg = result.get("error", str(result))
                # 如果是主键冲突，跳过
                if "UNIQUE constraint" in str(err_msg) or "already exists" in str(err_msg):
                    skip_count += 1
                    fail_count -= 1
                    print(f"    [{idx+1}/{len(voucher_issues)}] ⏭️ #{voucher_id} 已存在，跳过")
                else:
                    print(f"    [{idx+1}/{len(voucher_issues)}] ❌ #{voucher_id} 失败: {err_msg}")

        except Exception as e:
            fail_count += 1
            print(f"    [{idx+1}/{len(voucher_issues)}] ❌ #{voucher_id} 异常: {e}")

        time.sleep(0.1)  # 避免太快

    # 4. 汇总
    print("\n" + "=" * 60)
    print("迁移完成！")
    print(f"    总计：{len(voucher_issues)} 个")
    print(f"    成功：{success_count} 个")
    print(f"    跳过（已存在）：{skip_count} 个")
    print(f"    失败：{fail_count} 个")
    print("=" * 60)


if __name__ == "__main__":
    main()