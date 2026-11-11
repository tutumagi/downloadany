# DownloadAny 网页版需求与部署设计

状态：v0.1 设计草案 · 2026-11-11

## 1. 首版决策

DownloadAny 面向想保存自己有权下载的视频的用户。手机和电脑打开网页，粘贴一个网址，识别其中的视频，选择后保存。页面有多个可下载视频时分别列出；能播放或能复制链接不计作下载成功。未来的浏览器扩展、桌面端可以复用解析接口。

**首发承诺：可直接保存的公开 MP4，以及普通网页静态 HTML 里的可下载 MP4。** v0.1 定位为限来源公测：从一个自有或明确获准的测试网页域名及其媒体域名开始，首页列明已支持范围。其他来源提示暂未开放，开放任意公网普通网页前需要完成出网验证。四个平台都在评估范围，但不预先宣传支持：小红书优先验证，抖音和 B 站随后验证，YouTube 暂缓。首发范围不用等平台验证结果。

**部署：Cloudflare Workers + Static Assets，拟用 `download.tutudev.com`。** 免费档承载前端和轻量解析，视频从源站直接到用户设备。首发不配置付费容器、对象存储或数据库。

## 2. 五类来源的可行性

这里的成本包括开发、上线后的维护和下载交付。开源解析器只能证明有可参考的技术路径；本稿没有对真实平台样例或 Cloudflare 部署环境做下载测试。公开可观看也不能推定平台允许第三方服务自动提取和下载。

| 来源 | 低成本可行性与主要限制 | v0.1 决策 |
| --- | --- | --- |
| 普通网页 MP4 | **低。** 公开 MP4 直链，以及静态 HTML 的 `<video src>`、`<video><source>`、明确声明的 MP4 元数据，可由 Worker 识别。源站允许保存或浏览器可通过 CORS 读取时，视频无需经过本服务。 | **首发。** 动态播放器、需会话的资源、分片清单和跨域只可播放的资源不算支持。 |
| 小红书 | **中，最值得先验证。** [yt-dlp 的小红书解析器](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/xiaohongshu.py) 显示视频笔记存在可提取的媒体格式；分享短链、部分笔记访问条件和 CDN 能否直接交付仍须实测。 | **第一候选，默认关闭。** 只评估单条视频笔记及官方分享链接。上线前核对[小红书现行用户服务协议](https://agree.xiaohongshu.com/h5/terms/ZXXY20220331001/-1)及允许的接入方式；暂不支持图文和合集。 |
| 抖音 | **中高。** [上游存在抖音解析器](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py)，但视频页、分享短链和云端匿名访问的成功率不能由此推出。[抖音用户服务协议](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/douyin_agreement/26cc76ba-c2e5-4213-b59e-d0231b7ff602.html)限制未经授权的自动化使用。 | **第二候选，默认关闭。** 有允许的接入路径后验证单条公开视频；遇到登录或验证要求时停止，不做去水印承诺。 |
| B 站 | **中高。** [上游解析器](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)有 DASH 分开的音视频轨；若可用清晰度只提供分轨，需要合并才能交付。另需核对[B 站用户协议](https://www.bilibili.com/blackboard/protocal/licence.html)对自动获取内容的限制。 | **后续候选，默认关闭。** 有允许的接入路径后先验证单 P 普通投稿中可直接保存的有声 MP4。高画质合轨、多 P、番剧和会员内容不进首发。 |
| YouTube | **高。** [yt-dlp 上游文档](https://github.com/yt-dlp/yt-dlp/wiki/EJS)显示其 YouTube 路径涉及额外 JavaScript 运行时；[YouTube 服务条款](https://www.youtube.com/t/terms)限制下载，[API 政策](https://developers.google.com/youtube/terms/developer-policies)也不提供通用下载授权。 | **暂缓。** 给出打开原站的入口；自己的上传可走 [YouTube Studio 官方下载](https://support.google.com/youtube/answer/56100)。 |

平台候选通过两道门槛才能单独开启：有允许的接入与下载路径；并且在计划部署环境中，从链接输入到保存文件整条链路达标。验证建议：每站 10 条确认有权用于验证的样例，覆盖长链接与主流分享链接，间隔至少一天跑两轮，每轮至少 9 条实际保存并可播放，且没有某种链接形态系统性失败。记录地区、日期和失败类别。这个门槛用于决定是否开放测试，不代表平台全量成功率。任何候选未达标都不阻塞普通 MP4 上线。

## 3. 用户流程与功能边界

1. 首页提供一个输入框、一个「解析视频」按钮和支持范围提示。接受单条 HTTP(S) 网址，也允许从分享文案中提取唯一网址；有多条网址时提示只保留一条。
2. 解析时显示进度状态并避免重复提交。已识别但尚未开放的平台，直接给出站点对应提示和打开原站的入口，不走通用网页解析兜底。
3. 成功时按页面顺序列出可下载结果，合并相同媒体 URL。每条显示标题或文件名、来源和格式；清晰度、大小、时长有可信数据才显示。视频 URL 可能带短期参数，保持原样发起获取，不用删除查询参数的方式去重。
4. 「下载」只对应可保存的交付路径。源站以附件交付时交给浏览器下载；若支持跨域读取，可对已知不超过 25 MiB 的 MP4 由浏览器生成本地文件，读取超过上限时中止。其余只显示「打开源视频」和「复制链接」，标为仅可打开，不计作成功。发起下载后显示「已发起下载」；网页不能可靠确认浏览器最终是否保存成功。[浏览器下载行为](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a) · [跨域读取规则](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
5. 区分网址无效、来源未开放、页面未识别到 MP4、只有播放地址、源站要求登录或验证、链接失效、请求超时或受限。临时错误允许重新解析，失效链接提示重新粘贴分享链接。

首版不做注册、历史、批量、网盘、直播、分片合并和转码。网页应用不读取用户在源站的登录状态或 Cookie，不处理 DRM、付费、私密内容，不替代平台的下载权限设置。

## 4. 技术方案与部署

| 方案 | 适合什么 | 取舍 |
| --- | --- | --- |
| 纯静态前端 | 可直接保存的单个视频地址 | 部署最简单，但普通网页常无法由前端跨域读取，不能完成网页解析。 |
| **Workers + Static Assets** | 静态网页解析、按来源适配、从源站交付 | 选用。单项目同域部署，适合低成本上线；受 Worker CPU 限额和源站可达性限制。 |
| Workers + 独立容器 | 已获允许且确实需要原生工具、合轨或受控出网的来源 | 留作扩展。可隔离解析和处理，但新增运行、维护和视频流量成本，不作为首发依赖。 |

前端用 TypeScript + Vite，优先复用浏览器原生下载能力。Worker 提供同域 `POST /api/v1/inspect`：接收网址，输出来源、候选视频、交付方式、可选元数据和可重试的错误状态。按来源分发给独立适配器；网页与适配器只通过统一结果协议衔接。通用适配器用 [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) 扫描静态 HTML，按最终页面 URL 和有效的 base URL 解析相对媒体地址，不执行页面脚本或递归抓取 iframe。

Worker 的出网策略决定通用模式的开放范围。**预览先放行经确认的测试站点和对应的媒体域名；只有出网层能约束实际连接的目标时，才开放任意公网普通网页的解析。** 所有服务端访问只走 HTTP(S) 默认端口，对每一跳重定向和每个媒体目标重新校验；禁止内网、回环、链路本地和云元数据地址。对任意域名仅预查 DNS 无法保证实际连接仍是已校验地址。若 Workers 预览无法验证这一点，继续使用按域名放行的首版；开放任意网站前再接隔离的出网服务。不要将第三方响应原样返回，也不转发用户的凭据。[OWASP 服务端请求防护](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

初始限制建议：单次解析总时限 8 秒，最多 3 跳重定向、读取 1 MiB HTML、返回 10 条候选。媒体探测只读取必要的响应头和有限的响应数据，不拉取整个视频。附件和跨域读取的判断以实际 GET 路径为准；跨域响应须允许当前网页来源，并能确认完整文件大小。只有 HEAD 可用、源站拒绝探测或交付条件无法确认时，按「仅可打开」降级。浏览器点击下载后仍可能遇到源站响应变化，此时给出重试或打开源视频的入口。达到解析限制时说明结果可能不完整。加基础限流；日志仅记来源分类、结果码和耗时，不记完整网址、签名参数或原始请求体。若源站不允许浏览器保存，不开放通用视频中转。

部署顺序：

1. 本地使用自有或有许可的 MP4 测试页验证直链、多个视频和各种失败状态。
2. 用 Wrangler 部署独立预览 Worker 到 `workers.dev`，限制测试访问；验证真实 Worker CPU 和目标浏览器保存行为。
3. 检查 `tutudev.com` 是否为有效的 Cloudflare zone，以及 `download.tutudev.com` 有无记录冲突。无冲突时为生产 Worker 添加 Custom Domain，让 Cloudflare 配置 DNS 和 TLS；若域名状态不满足，保留预览入口，单独处理域名。[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
4. 在正式域名复验 HTTPS、解析和下载。单个来源可通过配置关闭；版本问题通过 [Workers 版本回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)恢复。

**费用预期：首版 Cloudflare 新增基础设施费用目标为 US$0/月，不含已有域名。** [静态资源请求](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)免费；[Workers 免费档](https://developers.cloudflare.com/workers/platform/limits/)是每天 100,000 次 Worker 请求、每次 10 ms CPU。8 秒是网络与解析的总等待上限，不代表可用 8 秒 CPU。上线前用预览数据确认 HTML 解析不会频繁触发 CPU 限额。只有平台验证或通用出网确实需要独立服务，再选 Cloudflare Containers 等方案；[Cloudflare Containers](https://developers.cloudflare.com/containers/platform/pricing/)需要 Workers Paid（目前 US$5/月起），容器超出包含用量后的费用另计。

未来如果有授权来源需要合轨，Worker 只受理请求并返回任务状态，由独立容器执行 FFmpeg，设置时长、文件大小和并发上限。先验证任务成功率和单次成本；有临时文件交付需求再引入短期存储和自动清理。扩展或桌面端可在统一接口之外增加本地处理，但不影响首发的网页流程。

## 5. 首版验收

| 场景 | 通过标准 |
| --- | --- |
| 公开 MP4 直链 | 分别用源站附件和可跨域读取的小文件样例，从输入到保存得到可打开的 MP4；带音轨的样例保存后声音正常。只有 HEAD 给出积极信号的样例不能误标为可下载。 |
| 普通网页 MP4 | 含相对路径、重复媒体地址及多个独立视频的样例，按页面顺序正确去重，分别可保存；超过候选上限有提示。 |
| 跨域只可播放 | 不展示误导性的「下载成功」或「下载」按钮；可以打开源视频或复制地址。 |
| 分享和不支持的链接 | 分享文案只提取唯一 URL；多链接提示明确；关闭的平台统一提示暂未开放，不尝试判断链接有效性；失效和受限提示用已支持来源的样例验收。 |
| 服务端出网限制 | 用受控样例验证非允许域名及重定向到受限目的地被拦截。通用开放前另验证实际出网约束。 |
| 预览验收 | 桌面 Chrome、iOS Safari、Android Chrome 在预览域名完成两种交付路径的实际保存，日志不含原始网址。 |
| 正式上线 | 正式域名 HTTPS 和解析接口正常；用正式网页来源复验两种交付路径。若子域名无法绑定，可通过预览验收，正式上线仍待完成。 |

当前工作只做需求评估与部署设计。产品代码、线上样例验证、DNS 绑定和付费资源开通属于后续阶段。
