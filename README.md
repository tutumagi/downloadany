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

## 验证

```sh
npm test
npm run typecheck
npm run deploy:check
# 本地服务运行时，另开一个终端（需要安装 Chrome）
npm run test:browser
```

浏览器测试逐字节核对下载结果，并验证网页中多个视频的识别、跨域保存和 390px 布局。跨域样例由浏览器测试拦截并提供响应，无须访问外站。iOS Safari 和 Android Chrome 的真机验收留到预览阶段。

## Git Flow 与发布

`main` 是正式发布线，`develop` 是集成线；功能分支使用 `codex/feature/`，发布与热修使用 `release/` 和 `hotfix/`，版本标签用 `v`。日常从 `develop` 开发，经验证后合回 `develop`。

本地验收后，登录 Cloudflare，确认 Wrangler 使用正确的账户，并在 `develop` 上运行 `npm run deploy:preview`，获得 `workers.dev` 试用链接。Wrangler 配置未声明任何自定义域名。试用验收后，再核对 Namecheap 注册域名实际使用的 DNS 服务和 Cloudflare zone 状态，确认子域名无冲突后为 `download.tutudev.com` 配置 Worker Custom Domain。注册商和 DNS 托管商可以不同。

需求和限制见[设计稿](docs/superpowers/specs/2026-11-11-downloadany-web-design.md)。
