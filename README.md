# DownloadAny

在浏览器里粘贴一个网址，找出其中的 MP4，再选择保存。v0.1 支持直链和静态 HTML 中的 MP4；B 站、抖音、小红书和 YouTube 暂未开放。

## 本地试用

需要 Node.js 22.18 或更新版本（Vite 也支持 Node.js 24 LTS）。

```sh
npm ci
npm run dev
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)，点击「试试 MP4 直链」或「试试视频网页」。示例网页包含两个本项目生成的有声短片，其中一个以附件方式交付，另一个由浏览器读取后保存。修改网页后重启 `npm run dev` 以重新构建静态资源。

默认只允许内置示例。需要测试自有或明确获准的公开站点时，在 `wrangler.jsonc` 的 `vars.ALLOWED_HOSTS` 配置精确的页面、跳转和媒体主机名，用英文逗号分隔；无需更改解析器。只加入你信任其 DNS 和内容的主机。每次请求及重定向均重新检查目的地。端口、IP 地址、私有站点和四个平台不开放。视频字节由浏览器从源站获取；跨域只可播放或超过浏览器保存上限时，显示「打开源视频」和「复制链接」。

## 本地浏览器扩展：播放页 MP4 和 HLS 回放

需要 Chrome 或 Edge 121 及以上。DownloadAny 网页发起任务，扩展在本机处理流媒体。

1. 运行 `npm ci` 和 `npm run build:extension`。
2. 在 Chrome 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」，选择「加载已解压的扩展程序」，选择仓库里的 `dist-extension`。
3. 打开 [DownloadAny 本地网页](http://127.0.0.1:8787)，粘贴链接并点「解析视频」。已知高途回放和 HLS/DASH 清单会直接打开下载面板；其他网页若无法静态解析，可以点「在播放页识别」。
4. 下载面板必要时会请你授予播放站点权限，再打开原播放页。若没有自动播放，请点播放。检测到播放器当前使用的单个 MP4 或单一 HLS 来源时会自动尝试下载 MP4；浏览器拦截时仍可点「保存 MP4」。多个无法区分的来源由你选择。

也可以直接在原播放网页点击扩展图标。已有扩展的用户需要先重新加载扩展并刷新 DownloadAny 网页。当前网页桥只接受本地 8787、[Cloudflare 预览](https://downloadany.tufei-fly.workers.dev)和预留的 `download.tutudev.com`。预览需要扩展 0.3.2 或更新版本。

本版支持播放后加载的原始 MP4，也能合并未加密、同源分片且音视频同流的 HLS，输出最多 2 GiB。扩展不会把媒体地址或登录信息传给 DownloadAny 服务。需要登录权限、加密、跨域分片、分离音轨或 DASH 的内容暂不能导出。识别依据是当前播放页和同源内嵌页的媒体信息及近期请求；有些播放器不会暴露足够信息。关闭浏览器或标签页前请等待保存完成。扩展会定期清理浏览器里用于生成文件的临时副本。

## 验证

```sh
npm test
npm run typecheck
npm run deploy:check
# 本地服务运行时，另开一个终端（需要安装 Microsoft Edge）
npm run test:browser
```

浏览器测试统一使用 Microsoft Edge，逐字节核对下载结果，并验证网页中多个视频的识别、跨域保存和 390px 布局。跨域样例由浏览器测试拦截并提供响应，无须访问外站。

扩展测试另需 FFmpeg/FFprobe 和已安装的 Microsoft Edge：

```sh
npm run build
npm run build:extension
npm run test:hls-media
npm run test:extension
```

测试使用本地生成的 HLS，核对合并后 MP4 的时长、视频和音频。Edge 扩展测试另外检查播放标签页识别、DASH 提示、动态 MP4 保存和无 Cookie 请求。

## Git Flow 与发布

`main` 是正式发布线，`develop` 是集成线；功能分支使用 `codex/feature/`，发布与热修使用 `release/` 和 `hotfix/`，版本标签用 `v`。日常从 `develop` 开发，经验证后合回 `develop`。

本地验收后，登录 Cloudflare，确认 Wrangler 使用正确的账户，并在 `develop` 上运行 `npm run deploy:preview`，获得 `workers.dev` 试用链接。Wrangler 配置未声明任何自定义域名。试用验收后，再核对 Namecheap 注册域名实际使用的 DNS 服务和 Cloudflare zone 状态，确认子域名无冲突后为 `download.tutudev.com` 配置 Worker Custom Domain。注册商和 DNS 托管商可以不同。

需求和限制见[设计稿](docs/superpowers/specs/2026-11-11-downloadany-web-design.md)。
