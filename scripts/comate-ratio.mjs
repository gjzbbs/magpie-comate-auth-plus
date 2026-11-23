// 查询 Comate 官方模型目录的倍率（ratio）与上下文窗口（maxContextWindow，单位 K）
// 用法：bun scripts/comate-ratio.mjs            # license 取 env COMATE_LICENSE 或 /root/.comate_license
//       COMATE_LICENSE=xxxx bun scripts/comate-ratio.mjs
import { readFileSync } from "node:fs"

const lic = (process.env.COMATE_LICENSE || (() => {
  try { return readFileSync("/root/.comate_license", "utf8") } catch { return "" }
})()).trim()
if (!lic) { console.error("no license: set COMATE_LICENSE or /root/.comate_license"); process.exit(1) }

const r = await fetch("https://comate.baidu.com/api/v2/api/models/available", {
  method: "POST",
  headers: {
    "content-type": "application/json", accept: "application/json",
    "login-name": encodeURIComponent(lic), "Uuap-login-name": encodeURIComponent(lic),
    "X-Source": "COMATE", "plugin-version": "1.8.0", "X-Trace-Id": crypto.randomUUID(),
  },
  body: JSON.stringify({ username: lic, type: "ZULU", rootRepo: "", submodules: [], zuluVersion: "1.8.0", source: "plugin", ideType: "zulucli" }),
})
const j = await r.json().catch(() => ({}))
const list = j?.data?.models || []
if (!list.length) { console.error("HTTP", r.status, "no models:", JSON.stringify(j).slice(0, 200)); process.exit(1) }
console.log("ratio".padEnd(7) + "model".padEnd(28) + "context".padEnd(12) + "img/think")
for (const m of list) {
  console.log(String(m.ratio || "-").padEnd(7) + String(m.modelType || "").padEnd(28) + String((m.maxContextWindow || 0) + "K").padEnd(12) + `${m.supportImage ? "img" : "-"}/${m.supportThinking ? "think" : "-"}`)
}
