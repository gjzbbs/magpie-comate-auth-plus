// 合并增强自检（不依赖 node --test，避免 runner 残留句柄挂住）
import assert from "node:assert/strict"
import { deviceLogin } from "./device-auth.mjs"
import { isComate, credential } from "./discovery.mjs"
import { ComateAuthPlugin, _internal } from "./index.mjs"

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(["ok", name])
  } catch (error) {
    results.push(["FAIL", `${name} :: ${error.message}`])
  }
}

await check("设备授权：轮询两次 400 后确认，取到 license 并给出 Magpie 认得的形状", async () => {
  let polls = 0
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    calls.push(u)
    if (u.includes("/api/client/generate/token")) {
      polls += 1
      if (polls < 3) return json(400, { status: "FAIL" })
      return json(200, { status: "OK", data: "client-token-abc" })
    }
    if (u.includes("/api/client/key")) {
      assert.equal(init.headers?.token, "client-token-abc")
      return json(200, { status: "OK", data: { key: "license-xyz", displayName: "王一" } })
    }
    throw new Error(`unexpected ${u}`)
  }
  const flow = deviceLogin({ fetchImpl, sleep: async () => {}, pollMs: 0 })
  assert.match(flow.url, /^https:\/\/comate\.baidu\.com\/zh\/login\?/)
  assert.match(flow.url, /track=COMATE_CLI/)
  assert.match(flow.url, /clientId=[0-9a-f-]{36}/)
  assert.equal(flow.method, "auto")
  const result = await flow.callback("", {})
  assert.equal(result.type, "success")
  assert.equal(result.access, "license-xyz")
  assert.equal(result.license, "license-xyz")
  assert.equal(result.source, "device")
  assert.equal(result.accountId, "王一")
  assert.equal(polls, 3)
  // Magpie 宿主会把 authorize 返回的 {type:"success"} 按登录方式转存成 type:"oauth"，
  // 与实际落库形状一致（DB 里 device 账号就是 type:oauth + source:device）。
  const persisted = { ...result, type: "oauth" }
  assert.equal(isComate(persisted), true, "isComate 必须接受 device 来源")
  const cred = await credential(async () => persisted, {})
  assert.equal(cred.license, "license-xyz")
})

await check("设备授权：授权完成但无 key 时不伪造成功", async () => {
  const fetchImpl = async (url) => String(url).includes("generate/token")
    ? json(200, { status: "OK", data: "t" })
    : json(200, { status: "OK", data: {} })
  const result = await deviceLogin({ fetchImpl, sleep: async () => {} }).callback("", {})
  assert.equal(result.type, "failed")
  assert.match(result.error, /没有取得 License/)
})

await check("设备授权：取消时给出可读失败", async () => {
  const aborter = new AbortController()
  aborter.abort()
  const result = await deviceLogin({ fetchImpl: async () => json(401, {}), sleep: async () => {} }).callback("", { signal: aborter.signal })
  assert.equal(result.type, "failed")
})

await check("插件暴露三种登录方式，设备授权排第一", async () => {
  const plugin = await ComateAuthPlugin({}, {})
  const auth = plugin.auth ?? plugin.provider?.auth
  assert.ok(auth, "插件必须带 auth hooks")
  const methods = auth.methods ?? []
  assert.equal(methods.length, 3, `期望 3 种登录方式，实际 ${methods.length}`)
  assert.match(methods[0].label, /设备授权/)
  assert.equal(methods[0].type, "oauth")
  assert.ok(methods.some((m) => m.type === "api"), "仍要保留粘贴 license 的方式")
})

await check("工具通道仍在（0.5.12 协议层）", async () => {
  assert.equal(typeof _internal.parseToolCalls, "function")
  assert.equal(typeof _internal.ToolTextParser, "function")
  assert.equal(typeof _internal.consumeComateSSE, "function")
})

await check("凭据判据仍拒绝无关来源", async () => {
  assert.equal(isComate({ type: "oauth", source: "magpie" }), false)
  assert.equal(isComate({ type: "api", source: "device", key: "k" }), false)
  assert.equal(isComate({ type: "api", source: "comate-paste", metadata: { source: "comate-paste" }, key: "k" }), true)
  assert.equal(isComate({ type: "oauth", source: "comate-paste", access: "k" }), true)
})

await check("倍率写成面板可排序的 x{num} credits", async () => {
  const modelOf = _internal.modelOf
  assert.equal(typeof modelOf, "function", "需要 _internal.modelOf")
  const of = (ratio) => modelOf({ id: "comate" }, { modelId: "m1", displayName: "GLM-5.3", ratio }, "https://comate.baidu.com")
  assert.equal(of("0.3x").credits, "x0.3 credits")
  assert.equal(of("1x").credits, "x1 credits")
  assert.equal(of("0.1x").credits, "x0.1 credits")
  assert.equal(of("").credits, undefined, "上游没给倍率就不要编一个值")
  // 面板解析器与格式化器共用 /x\s*([\d.]+)/i：x 在数字前才算得出倍率
  assert.equal(/x\s*([\d.]+)/i.exec(of("0.3x").credits)[1], "0.3")
})

for (const [state, name] of results) console.log(`${state === "ok" ? "PASS" : "FAIL"}  ${name}`)
const failed = results.filter(([s]) => s !== "ok").length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)