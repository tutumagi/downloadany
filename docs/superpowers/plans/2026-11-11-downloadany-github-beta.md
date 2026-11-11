# DownloadAny GitHub Beta 与安装入口

1. 把首个 GitHub 预发行定为 `v0.3.2-beta.1`，扩展清单保留浏览器要求的纯数字版本 `0.3.2`。用现有打包脚本生成只信任正式 HTTPS 入口的 Beta ZIP。
2. 添加同源安装页。首页导航和流媒体找不到扩展时都能进入。Beta 区提供 GitHub Release ZIP 与 Edge、Chrome 开发者模式步骤；商店区从独立配置读取已发布链接，尚未配置时显示待上架。添加商店链接不移除 Beta 下载。
3. 用 Microsoft Edge 验证安装入口、剪贴板说明、缺少扩展的引导和两种商店链接的切换。
4. 走 Git Flow 合并、打标签，推送 `main` 和 `develop` 到公开 GitHub 仓库；公开预发行版及 ZIP。确认游客可下载后再部署网站，并用 Edge 复验。此次不改 DNS 或绑定自定义域名。
