// 设备授权登录 + 与 0.5.12 凭据判据的对接测试（合并增强部分）
import test from "node:test"
import assert from "node:assert/strict"
import { deviceLogin } from "./device-auth.mjs"
import { isComate, credential } from "./discovery.mjs"
import { ComateAuthPlugin, _internal } from "./index.mjs"

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("deviceLogin: 轮询到网页确认后取得 license 并给出 Magpie 认得下的 auth 形状", async () => {
  const calls = []
  let polls = 0
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, headers: init.headers ?? {} })
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
  assert.equal(result.key, "license-xyz")
  assert.equal(result.license, "license-xyz")
  assert.equal(result.source, "device")
  assert.equal(result.accountId, "王一")
  assert.equal(result.expires, 0)
  assert.equal(polls, 3)

  // 关键：0.5.12 的凭据判据必须接受 device 来源，否则工具通道拿不到 license
  assert.equal(isComate(result), true)
  const cred = await credential(async () => result, {})
  assert.equal(cred.license, "license-xyz")
})

test("deviceLogin: 超时与取消分别给出可读失败", async () => {
  const slow = deviceLogin({ fetchImpl: async () => json(401, { status: "FAIL" }), sleep: async () => {}, timeoutMs: 5, pollMs: 0 })
  const timedOut = await slow.callback("", {})
  assert.equal(timedOut.type, "failed")
  assert.match(timedOut.error, /超时|设备授权/)

  const cancelled = new AbortController()
  cancelled.abort()
  const flow = deviceLogin({ fetchImpl: async () => json(401, {}), sleep: async () => {} })
  const aborted = await flow.callback("", { signal: cancelled.signal })
  assert.equal(aborted.type, "failed")
})

test("deviceLogin: 授权完成但拿不到 key 时不伪造成功", async () => {
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes("generate/token")) return json(200, { status: "OK", data: "t" })
    return json(200, { status: "OK", data: {} })
  }
  const result = await deviceLogin({ fetchImpl, sleep: async () => {} }).callback("", {})
  assert.equal(result.type, "failed")
  assert.match(result.error, /没有取得 License/)
})

test("插件暴露三种登录方式，设备授权排第一", async () => {
  const plugin = await ComateAuthPlugin({}, {})
  assert.equal(plugin.provider.id, "comate")
  const labels = plugin.auth.methods.map((m) => m.label)
  assert.equal(plugin.auth.methods.length, 3)
  assert.match(labels[0], /设备授权/)
  assert.equal(plugin.auth.methods[0].type, "oauth")
  // 工具通道仍然完整：能力声明与工具协议辅助都已挂在入口上
  assert.equal(typeof _internal.parseToolCalls, "function")
  assert.equal(typeof _internal.ToolTextParser, "function")
})

test("isComate 仍然拒绝无关来源", () => {
  assert.equal(isComate({ type: "oauth", source: "magpie" }), false)
  assert.equal(isComate({ type: "api", source: "device", key: "k" }), false)
  assert.equal(isComate({ type: "api", source: "comate-paste", metadata: { source: "comate-paste" }, key: "k" }), true)
})