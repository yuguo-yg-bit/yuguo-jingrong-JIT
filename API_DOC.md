# 玉国金融【全球通】API 文档

> 后端服务：Cloudflare Workers + D1 (SQLite)
> 
> **⚠️ 重要：GitHub Issues API 已废弃，请使用以下新接口**

---

## 接口基础信息

| 项目 | 值 |
|------|------|
| API 域名 | `https://yuguo-api.你的用户名.workers.dev` |
| 数据格式 | JSON |
| 编码 | UTF-8 |
| 跨域 | 已配置 CORS，支持所有来源 |

---

## 接口列表

### 凭证管理

#### GET /vouchers — 获取凭证列表（分页）

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 10 |

**响应示例**
```json
{
  "ok": true,
  "data": [
    {
      "id": "v_1234567890",
      "user_id": "谭绣云",
      "order_type": "凭证",
      "shop_name": "盒马店",
      "amount": 10,
      "discounted_amount": 7,
      "discount": "7折",
      "status": "已审核",
      "payment_status": "待支付",
      "payment_method": "unionFirst",
      "created_at": "2026-03-05 14:30:00"
    }
  ]
}
```

---

#### POST /vouchers — 新增凭证

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 凭证ID（前端生成唯一ID） |
| user_id | string | 是 | 用户ID |
| order_type | string | 否 | 凭证 / 电器补贴 / 线上购物，默认 凭证 |
| shop_name | string | 是 | 店铺名称 |
| shop_photo | string | 否 | 店铺照片URL |
| order_photos | array | 否 | 商品订单照片URL数组 |
| latitude | string | 否 | 纬度 |
| longitude | string | 否 | 经度 |
| amount | number | 是 | 原价金额 |
| remark | string | 否 | 备注 |
| signature | string | 是 | 签名图片URL |
| payment_method | string | 否 | unionFirst / userFirst |
| electric_category | string | 否 | 电器分类（电器补贴专用） |
| electric_brand | string | 否 | 品牌（电器补贴专用） |
| subsidy_rate | number | 否 | 补贴比例，如 0.05 |

**请求示例**
```json
{
  "id": "v_1712345678901",
  "user_id": "谭绣云",
  "order_type": "凭证",
  "shop_name": "盒马店",
  "shop_photo": "https://xxx.jpg",
  "order_photos": ["https://xxx1.jpg", "https://xxx2.jpg"],
  "latitude": "31.2304",
  "longitude": "121.4737",
  "amount": 10,
  "remark": "购买零食",
  "signature": "https://xxx-sign.png",
  "payment_method": "unionFirst"
}
```

**响应示例**
```json
{ "ok": true, "id": "v_1712345678901" }
```

---

#### PUT /vouchers/status — 更新凭证审核状态

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 凭证ID |
| status | string | 是 | 待审核 / 已审核 / 已拒绝 / 加急申请中 |
| review_remark | string | 否 | 审核备注 |
| reviewed_by | string | 否 | 审核人 |

**请求示例**
```json
{
  "id": "v_1712345678901",
  "status": "已审核",
  "review_remark": "审核通过",
  "reviewed_by": "admin"
}
```

---

#### PUT /vouchers/lottery — 更新抽奖结果

> 会自动计算优惠后金额

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 凭证ID |
| discount | string | 是 | 免单 / 7折 / 8折 / 9折 / 9.5折 / 10折 / 11折 / 12折 / 13折 / 14折 |

**请求示例**
```json
{
  "id": "v_1712345678901",
  "discount": "7折"
}
```

**响应示例**
```json
{ "ok": true, "discounted": 7 }
```

---

### 用户管理

#### GET /user — 获取用户信息（不存在则自动创建）

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |

**响应示例**
```json
{
  "ok": true,
  "data": {
    "id": "谭绣云",
    "username": "谭绣云",
    "points": 150,
    "member_level": "1级IT会员",
    "member_progress": 0.65,
    "created_at": "2026-01-01 08:00:00"
  }
}
```

---

#### PUT /user/points — 更新用户积分

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |
| delta | number | 是 | 积分变动（正数=增加，负数=减少） |

**请求示例**
```json
{
  "user_id": "谭绣云",
  "delta": 25
}
```

**响应示例**
```json
{ "ok": true, "points": 175 }
```

---

### 积分记录

#### GET /points — 获取积分历史

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |

**响应示例**
```json
{
  "ok": true,
  "data": [
    {
      "id": "ph_001",
      "user_id": "谭绣云",
      "delta": 25,
      "reason": "审核通过",
      "voucher_id": "v_1712345678901",
      "created_at": "2026-03-05 15:00:00"
    }
  ]
}
```

---

#### POST /points — 添加积分记录

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 记录ID |
| user_id | string | 是 | 用户ID |
| delta | number | 是 | 积分变动 |
| reason | string | 是 | 原因：添加凭证 / 审核通过 / 抽奖奖励 / 积分抽奖 / 抵消差额 |
| voucher_id | string | 否 | 关联凭证ID |

---

### 通知

#### GET /notifications — 获取通知列表

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |

**响应示例**
```json
{
  "ok": true,
  "data": [
    {
      "id": "notif_001",
      "user_id": "谭绣云",
      "title": "凭证审核通过",
      "content": "您的凭证已审核通过，请参与抽奖！",
      "is_read": 0,
      "created_at": "2026-03-05 15:00:00"
    }
  ]
}
```

---

#### POST /notifications — 发送通知

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 通知ID |
| user_id | string | 是 | 接收用户ID |
| title | string | 是 | 通知标题 |
| content | string | 是 | 通知内容 |

---

### 聊天

#### GET /chat — 获取聊天记录

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |

**响应示例**
```json
{
  "ok": true,
  "data": [
    {
      "id": "chat_001",
      "user_id": "谭绣云",
      "sender": "user",
      "message": "请问审核需要多久？",
      "image": null,
      "voucher_id": null,
      "created_at": "2026-03-05 14:00:00"
    }
  ]
}
```

---

#### POST /chat — 发送聊天消息

**请求体（JSON）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 消息ID |
| user_id | string | 是 | 用户ID |
| sender | string | 是 | user / admin |
| message | string | 是 | 消息内容 |
| image | string | 否 | 图片URL |
| voucher_id | string | 否 | 关联凭证ID |

---

### 统计

#### GET /stats — 获取用户统计数据

**请求参数（Query）**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户ID |

**响应示例**
```json
{
  "ok": true,
  "data": {
    "total_vouchers": 15,
    "passed_vouchers": 12,
    "points": 150,
    "member_level": "1级IT会员"
  }
}
```

---

## 错误响应格式

```json
{ "ok": false, "error": "错误信息" }
```

常见 HTTP 状态码：
- `200` — 成功
- `400` — 参数错误
- `404` — 资源不存在
- `500` — 服务器错误

---

## 图片上传

> 图片不走 D1 API，直接上传到 GitHub 仓库

**图片上传地址**

```
https://api.github.com/repos/yuguo-yg-bit/yuguo-jingrong-JIT-images/contents/{文件名}
```

**上传方式**：PUT 请求，需要 GitHub Token

**请求头**
```
Authorization: token {你的GitHub Token}
Content-Type: application/json
```

**请求体**
```json
{
  "message": "上传凭证图片",
  "content": "{图片Base64编码（去掉data:image/xxx;base64,前缀）}"
}
```

**返回的图片地址**
```
https://raw.githubusercontent.com/yuguo-yg-bit/yuguo-jingrong-JIT-images/main/{文件名}
```

---

## 抽奖折扣计算规则

| 折扣 | 系数 | 示例（原价10元） |
|------|------|------|
| 免单 | 0 | 0元 |
| 7折 | 0.7 | 7元 |
| 8折 | 0.8 | 8元 |
| 9折 | 0.9 | 9元 |
| 9.5折 | 0.95 | 9.5元 |
| 10折 | 1.0 | 10元（无优惠） |
| 11折 | 1.1 | 需补1元 |
| 12折 | 1.2 | 需补2元 |
| 13折 | 1.3 | 需补3元 |
| 14折 | 1.4 | 需补4元 |

> 10折及以上为超出原价，用户需补差额，可用积分抵消（10积分=1元）

---

## 积分规则

| 操作 | 积分变动 |
|------|------|
| 添加凭证 | +15 |
| 审核通过 | +25 |
| 抽到免单/7-9.5折 | +50 |
| 抽到10折及以上 | +60 |
| 连续3天添加凭证 | +30 |
| 幸运抽奖（消耗） | -45 |
| 抵消差额 | -10积分=1元 |
| 转盘抽奖（消耗） | -10 |
