// Comate 官网设备授权（网页确认式登录）——移植自 qaz139688/magpie-comate-auth 0.2.4
// 原文件 device-auth.mjs，MIT。此处只改「返回给 Magpie 宿主的 auth 形状」，
// 让 0.5.12 的 cloud 通道（工具调用完整）也能吃到设备授权拿到的 license。
//
// 流程与百度官方 Zulu 1.7.21 的 SaaS 设备授权同源：
//   1) 打开 https://comate.baidu.com/zh/login?track=COMATE_CLI&clientId=<uuid>&device=<name>
//   2) 用户在网页登录并确认授权这台设备
//   3) 本插件轮询 GET /api/client/generate/token?clientId=<uuid> 直到 status=OK，拿到一次性 clientToken
//   4) GET /api/client/key?clientId=<uuid>（header: token=<clientToken>）→ data.key 即 license
// 全程不需要复制 Cookie，也不需要本机装有 Comate 桌面客户端。

import { randomUUID } from "node:crypto"

const BASE = "https://comate.baidu.com"

// Bun 认得 proxy:false（禁掉继承的本地代理）；Node 22 会忽略这个多余字段，无副作用。
const directFetch = (input, init = {}) => fetch(input, { ...init, proxy: false })

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort)
    resolve()
  }, ms)
  signal?.addEventListener("abort", onAbort, { once: true })
})

const string = (value) => (typeof value === "string" ? value : "")

export function deviceLogin({
  fetchImpl = directFetch,
  sleep = wait,
  timeoutMs = 180_000,
  pollMs = 2_000,
  deviceName = "Magpie Comate (Windows)",
} = {}) {
  const clientId = randomUUID()
  const url = new URL("/zh/login", BASE)
  url.searchParams.set("track", "COMATE_CLI")
  url.searchParams.set("clientId", clientId)
  url.searchParams.set("device", deviceName)

  return {
    url: url.toString(),
    instructions: "在打开的百度 Comate 页面登录并确认授权这台设备。确认后 Magpie 会自动取得 License，无需复制 Cookie；等待最长 3 分钟。",
    method: "auto",
    async callback(_code, { signal } = {}) {
      const deadline = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
      try {
        for (;;) {
          combined.throwIfAborted()
          const tokenUrl = new URL("/api/client/generate/token", BASE)
          tokenUrl.searchParams.set("clientId", clientId)
          const response = await fetchImpl(tokenUrl, {
            headers: { Accept: "application/json" },
            signal: combined,
            redirect: "error",
          })
          // 400/401 = 网页侧还没确认授权，继续轮询；其它状态码才算真错。
          if (![200, 400, 401].includes(response.status)) {
            throw new Error(`设备授权接口返回 HTTP ${response.status}，请重试登录`)
          }
          const result = response.status === 200 ? await response.json() : null
          if (result?.status === "OK" && string(result.data)) {
            const keyUrl = new URL("/api/client/key", BASE)
            keyUrl.searchParams.set("clientId", clientId)
            const keyResponse = await fetchImpl(keyUrl, {
              headers: { Accept: "application/json", token: result.data },
              signal: combined,
              redirect: "error",
            })
            if (!keyResponse.ok) throw new Error(`获取 License 返回 HTTP ${keyResponse.status}，请重试登录`)
            const payload = await keyResponse.json()
            const license = string(payload?.data?.key).trim()
            if (payload?.status !== "OK" || !license) {
              throw new Error("网页授权已完成，但没有取得 License，请重试登录")
            }
            const name = string(payload.data.displayName).trim() || license
            // ↓ 关键差异：0.5.12 的 discovery.isComate 认 oauth + source ∈ {comate, comate-paste, device}，
            //   credential 对非 "comate" 来源取 (access || key)，所以这里带 access 即可。
            return {
              type: "success",
              access: license,
              key: license,
              license,
              refresh: "",
              expires: 0,
              source: "device",
              accountId: name,
              name,
              clientId,
              clientToken: result.data,
            }
          }
          await sleep(pollMs, combined)
        }
      } catch (error) {
        if (signal?.aborted) return { type: "failed", error: "已取消登录" }
        if (deadline.aborted) return { type: "failed", error: "设备授权超时，请重新点登录并在网页确认授权" }
        return { type: "failed", error: error?.message || "设备授权失败，请重试登录" }
      }
    },
  }
}