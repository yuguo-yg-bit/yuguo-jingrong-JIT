# 安全加固 Phase 2：补齐 678977a 之后仍然敞开的口子

> 基线：`main@678977a`（上一轮已落地：抽奖审核前置、结算权收回、绑定/改密要求会话、
> 邮箱检查接口收权限、登录失败限流、响应头、明文凭据清理）。
> 本 PR **只补它没覆盖到的部分**，不重复它的改动，也不与它冲突。
> 部署平台仍然不变：GitHub Pages + Val.town + Turso。

---

## 一、先说结论：上一轮之后还剩 7 个真口子

| # | 问题 | 位置 | 实际后果 | 严重度 |
|---|---|---|---|---|
| 1 | 凭证详情仍可枚举 | `vouchers.get_by_id` 只有 `auth:"user"`，没有 `voucher` 归属校验 | 凭证 id 是连续整数，任何登录用户可遍历全站凭证（姓名、门店、金额、折扣、支付状态） | 高 |
| 2 | 口令仍是“单轮 SHA-256 + 仓库里写死的盐” | `hashPassword` / `SALT = "yuguo-jr-salt-2024"` | 哈希一旦泄露（`test-turso.html` 历史里就泄露过），GPU 每秒上亿次离线爆破；盐公开 = 盐无效 | 高 |
| 3 | CORS 仍在回退 | `getCorsHeaders` 未命中白名单时返回 `ALLOW_ORIGINS[0]` | 任意第三方站点都能读到接口响应（配合浏览器会话 = 跨站读数据） | 中高 |
| 4 | Turnstile fail-open | `if (!TURNSTILE_SECRET) return { ok: true }` | 漏配环境变量 = 登录/注册的人机验证整体失效，且没有任何报错 | 中高 |
| 5 | 用户名无字符集校验 | 注册入口只校验长度 | 用户名可含 `"`，而后台 `_escapeHtml` 不转义引号，且被拼进 `data-user="..."` → 属性注入 XSS | 中 |
| 6 | 借记只有 JS 预检 | `/points/action` 先查余额再入账 | 两个并发请求可同时通过预检 → 负余额被 `MAX(0, SUM)` 抹平 = 白拿 | 中 |
| 7 | `/sql` 可写身份表 | `assertSqlSafe` 只拦 `users.points` | 管理员会话一旦被劫持（或后台 XSS 得手），一条 UPDATE 即可提权/造会话；`WHERE 1` 可全表删 | 中 |

另有两个“减弱但未消除”的：

- `val-town-proxy-email-trigger.js` 现在只信 `From` 信头。**`From` 同样可伪造**——Val.town 的邮件处理器拿不到 DKIM/SPF 结论，攻击者用任意 SMTP 就能把 `From` 写成受害者地址。因为 `check-register` 已不再铸造会话，危害从“接管账号”降为“冒用邮箱完成自助注册验证”，但仍是一个身份伪造面。
- `/session/email-check` 已经要求本人会话，但仍在响应里回传邮箱明文，前端一有 XSS 就多一处泄露。

---

## 二、本 PR 的改动

### 1. 新增 `security/core.js`（安全内核，零第三方依赖）

- 严格 CORS：未命中白名单**不下发** ACAO；
- 统一安全响应头常量（含 HSTS / COOP / CORP）；
- `pbkdf2Hash` / `pbkdf2Verify`：PBKDF2-HMAC-SHA256，12 万次迭代、每用户随机盐、服务端 pepper；
- `timingSafeEqual`：常数时间比较；
- `isValidUsername`：中文/字母/数字/`_`/`-`，2–20 位；
- `isRateLimited`：Turso 存储的跨实例限流（进程内计数器冷启动会归零，这层不会）；
- HMAC 签名 / 时间戳新鲜度（为后续“敏感请求二次签名”预留）。

配套 27 项单测：`node tests/security.test.mjs`。

### 2. `val-town-proxy.js`

| 改动 | 说明 |
|---|---|
| CORS 严格化 | `getCorsHeaders` 直接走 `corsHeaders(origin, ALLOW_ORIGINS)`，不再回退 |
| 响应头合并 | `jsonResponse` 改为展开 `SECURITY_HEADERS`，补 HSTS / COOP / CORP |
| Turnstile 可配置 | 配了 `TURNSTILE_SECRET` 即强制校验；未配视为「未启用」放行并留审计，避免新环境部署后全站登录不可用。要强制拒绝可设 `TURNSTILE_ENFORCE=1`；验证服务网络故障返回 503（与校验失败 403 区分） |
| 口令升级 PBKDF2 | `hashPassword` 改为 PBKDF2；**登录时透明升级**旧 `sha256$` 值，用户无感 |
| 口令参数统一慢哈希 | `/db` 新增 `kdfParams` 钩子，`reg.create` / `users.update_password` / `reg.update_password` 写库前自动套 PBKDF2（防止“改密/重置”路径绕开新哈希） |
| 登录跨实例锁定 | 失败计数改为 **IP+账号维度、只统计失败**；先只读检查（`peek`）再验证，成功即清零。旧实现验密前自增，知道用户名就能锁号 15 分钟（锁号 DoS） |
| CORS 白名单 | 补裸域名 `https://yuguojinrong.cc.cd`（用户不带 www 访问时 Origin 不同，漏配会整站接口被拦）；`Allow-Headers` 补 `X-Auth-Token`，方法补 `PUT/DELETE` |
| pepper 兼容 | 先用当前 `PASSWORD_PEPPER` 校验，失败再试空 pepper；命中即按当前 pepper 重哈希，避免后补配置导致老用户全部登不上 |
| 管理员比对常数时间 | `===` 改为 `timingSafeEqual`，并支持 PBKDF2 存量 |
| 对象级授权 | `vouchers.get_by_id` 加 `voucher: 0`；`levels.get` 加 `owner: 0` |
| 用户名白名单 | `/db` 新增 `usernameParam` 钩子，`reg.create` 与邮箱注册入口统一校验 |
| 记账原子护栏 | 借记时把「流水余额 + delta ≥ 0」写进同一条 `INSERT` 的 `WHERE`；并发下由数据库单语句拒绝，不靠 `MAX(0)` 兜底 |
| 上传加固 | 单用户 20 张/小时；校验 base64 文件头只收真实 JPEG/PNG；按真实类型命名 |
| `/sql` 加固 | 禁止写身份/账务表（sessions / oauth_tokens / users / registrations / ledger / audit_logs / email_verifications / email_bindings）；`UPDATE`/`DELETE` 必须带 `?` 占位符（拦 `WHERE 1`） |
| 邮箱状态去明文 | `/session/email-check` 只返回 `hasEmail` |

### 3. `js/admin-main.js`

`_escapeHtml` 补转义 `"` 与 `'`。原实现 `textContent → innerHTML` 只处理 `< > &`，结果却被拼进 `data-user="..."` —— 一个带双引号的用户名就能闭合属性并注入事件。

### 4. `migrations/001_security_hardening_phase2.sql`

- `ledger.biz_no` **唯一索引**（当前幂等仅靠应用层 `WHERE NOT EXISTS`，并发会双写）；
- 去重后按账本回算 `users.points`（否则删了重复流水、余额仍保留重复加分）；
- `ledger(user_id, created_at)`、`audit_logs(action, created_at)` 检索索引；
- `rate_limits` 表（跨实例限流依赖）。

> ⚠️ 含 `DELETE` 去重与余额回算。执行前先跑文件顶部的体检 SQL 并备份。

---

## 三、上线顺序

1. 备份 Turso。
2. 跑体检 SQL → 有重复先人工确认 → 执行迁移。
3. Val.town 配置 `PASSWORD_PEPPER`（32 字节随机串；设了就别随意改）与 `TURNSTILE_SECRET`（可选：配了才强制人机验证；不配则自动跳过并在审计留痕）。
4. **先传 `security/core.js`，再传 `val-town-proxy.js`**（相对 import 依赖它已存在）。
5. 传 `js/admin-main.js`。
6. 回归验证（见下）。

## 四、回归清单

| 场景 | 预期 |
|---|---|
| 未登录 `POST /db` `vouchers.get_by_id` | 401 |
| A 用户读 B 用户凭证 id | 403 |
| 用户名填 `a" onmouseover="alert(1)` 注册 | 400 |
| 余额 0 调 `points_offset_payment` | 400 积分不足 |
| 用旧口令登录 | 200，且库里该用户 `password_hash` 变成 `pbkdf2$` |
| 未知 Origin 调接口 | 响应无 `Access-Control-Allow-Origin`，浏览器拒绝读取 |
| 向邮箱触发器发任意邮件 | 仍 410？→ 注意：本 PR 未停用它（上一轮已改成只信 From），此处维持现状 |
| `/sql` 执行 `UPDATE users SET is_admin=1 WHERE id='x'` | 403 被拦 |

## 五、仍未解决（需要平台能力，不假装修好）

1. **GitHub Pages 无法设响应头**：`security/_headers` 对 GH Pages 无效，页面级安全头必须前置 CDN 才生效；接口响应已有头。
2. **无 WAF / Bot 管理**：限流是应用层的“尽力而为”，挡不住分布式 IP。
3. **影像仍在公开仓库**：`/upload-image` 提交到公开 GitHub 仓库，raw 链接永久可访问；真私有化需对象存储 + 短时签名 URL。
4. **邮件触发器仍信 `From`**：没有 DKIM 就无法证明发件人，建议后续要么停用，要么改为“登录态内点确认”。
5. **CSP 仍含 `unsafe-inline`**：需把内联脚本外置才能收紧（大头工作量）。
6. **审计日志可被管理员删**：应改只追加并外送一份。
