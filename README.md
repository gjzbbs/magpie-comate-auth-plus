# magpie-comate-auth-plus

百度文心快码（Comate）的 Magpie provider 插件，合并两个上游的长处：

- 登录：来自 [qaz139688/magpie-comate-auth](https://github.com/qaz139688/magpie-comate-auth) 0.2.4 的**官网设备授权**（网页点一下确认，自动取得 License，不复制 Cookie、不手打 Key）
- 能力：来自 [PengJunchen/magpie-comate-auth](https://github.com/PengJunchen/magpie-comate-auth) 0.5.12 的**完整客户端工具链**（tools 映射、原生 tool_call 事件回填、工具名别名、参数恢复）、图片输入、原生会话续接、动态模型目录

## 为什么需要它

两个上游各缺一块：

| | qaz139688 0.2.4 | PengJunchen 0.5.12 | 本仓库 |
|---|---|---|---|
| 登录方式 | 官网设备授权，网页确认即可 | 只能读本机 Comate 桌面客户端，或手工粘贴 License | 设备授权（推荐）+ 桌面客户端 + 粘贴，三种并存 |
| 工具调用 | 无（`tool_call: false`、请求不发 tools、systemReminder 锁在 Ask 只读模式） | 完整 | 完整 |
| 模型目录 | 硬编码 15 个 | 动态 `POST /api/v2/api/models/available` | 动态 |
| 图片 / 会话续接 | 无 | 有 | 有 |

0.2.4 的工具调用不是「开关没开」，而是三层都写死：模型能力声明 `tool_call: false`、execute body 里 `toolUseResults: []` 且不带 `tools`、提示词固定 `Ask mode is active; only read-only tools are available`。补它不是加一个 flag，要移植整套上游工具协议。

所以本仓库以 0.5.12 为基座，只把「登录」这一层换掉。

## 与上游 0.5.12 的具体差异

| 文件 | 改动 |
|---|---|
| `device-auth.mjs` | 新增。移植自 qaz139688 0.2.4 的 `device-auth.mjs`，只改返回给宿主的 auth 形状（补 `access`/`key`/`license`，`source: "device"`） |
| `index.mjs` | 引入 `deviceLogin`；新增 `deviceSignIn()`；`auth.methods` 增加第一项「Comate 官网设备授权（网页确认，推荐）」 |
| `discovery.mjs` | `isComate()` 的 oauth 分支增加 `source === "device"`。原本只认 `comate`/`comate-paste`，会拒掉设备授权存下来的凭据 |
| `package.json` | 更名 `magpie-comate-auth-plus`，版本 `0.5.13`，`files` 增加 `device-auth.mjs` |
| `selftest.mjs` | 新增。设备授权全流程 + 凭据判据 + 三种登录方式的断言（6/6） |

设备授权流程（与百度官方 Zulu 1.7.21 的 SaaS 设备授权同源）：

1. 打开 `https://comate.baidu.com/zh/login?track=COMATE_CLI&clientId=<uuid>&device=<name>`
2. 用户在网页登录并确认授权这台设备
3. 插件轮询 `GET /api/client/generate/token?clientId=<uuid>` 直到 `status=OK`，拿到一次性 clientToken
4. `GET /api/client/key?clientId=<uuid>`（header `token: <clientToken>`）→ `data.key` 即 License，`data.displayName` 即账号名

落库形状（Magpie 宿主会把 authorize 的 `type:"success"` 按登录方式转存成 `type:"oauth"`）：

```json
{
  "type": "oauth",
  "source": "device",
  "access": "<license>",
  "key": "<license>",
  "license": "<license>",
  "accountId": "<displayName>",
  "name": "<displayName>",
  "refresh": "",
  "expires": 0
}
```

## 安装（Magpie / Agent2API 的脚本插件宿主）

插件是纯 ESM，没有构建步骤，也没有运行时依赖：

```bash
# 目录形态直接装
magpie plugin add https://github.com/<owner>/magpie-comate-auth-plus.git
```

Agent2API 这类以 `registry.json` 为注册真源的宿主，把包目录放进
`<data>/script-plugins/packages/<packageId>/<sha256前24位>/`，再在 `registry.json` 的
`packages` 里登记条目、在 `identities` 里写明 `{"comate": "comate"}` 即可；`POST /api/plugins/scripts/install`
在部分版本上会空转（只回 `stage:"starting"` 不落盘），手工登记更可靠。

## 自检

```bash
node selftest.mjs        # 6 项，含设备授权全流程与凭据判据
node --test *.test.mjs   # 上游原有测试（部分用例依赖 POSIX 路径，Windows 上会失败，与本次改动无关）
```

## 许可

MIT。上游两处代码的版权归各自作者：qaz139688（`device-auth.mjs` 的原始实现）、PengJunchen（0.5.12 主体）。本仓库只做合并与适配。