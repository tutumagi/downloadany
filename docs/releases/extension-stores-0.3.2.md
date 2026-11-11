# DownloadAny 0.3.2 双商店提交材料

## 商店字段

- 名称：DownloadAny · 分片视频
- 语言：简体中文
- 建议分类：效率工具；若商店使用更具体的工具分类，选其对应项。
- 网站：https://downloadany.tufei-fly.workers.dev/
- 隐私政策：https://downloadany.tufei-fly.workers.dev/privacy.html
- 分发方式：Edge Hidden、Chrome Unlisted，适用于链接邀请试用。两家商店独立审核。
- 公开支持邮箱：brucepower33@gmail.com。

简述：识别播放页里的 MP4 和未加密的 HLS，在本机保存你有权下载的视频。

详细说明：

> 打开 DownloadAny 网页并粘贴视频链接，或在原播放页点击扩展图标。扩展检查当前播放标签页，识别播放器使用的 MP4 以及支持的未加密 HLS。MP4 直接保存，音视频同流的 HLS 可在本机合并为 MP4。必要时，浏览器会提示授权所选播放站点或媒体来源。
>
> 适合保存自己的视频、开放素材或已获许可下载的媒体。扩展不读取登录 Cookie，不解密 DRM 或加密流，不导出 DASH。部分播放器及来源可能无法读取。媒体文件不上传到 DownloadAny 服务。

## 审核人员测试说明

1. 安装扩展并打开自有样例页 https://downloadany.tufei-fly.workers.dev/demo/clips.html 。
2. 播放 Orbit 样例，点击 DownloadAny 扩展图标。面板应列出一个 MP4 来源。
3. 点「生成 MP4」，生成后点「保存 MP4」。样例是本项目生成的有声音视频，无需账号、付款或外部网站权限。
4. 可在 https://downloadany.tufei-fly.workers.dev/ 使用「试试视频网页」验证配套网页的静态解析。它与扩展共用一个下载用途。

English reviewer notes: Open the first-party demo page above and play the Orbit video. Click the extension action, select the detected MP4, then generate and save it. The sample is project-generated, and no sign-in or credentials are needed. The extension processes recognized media on the device. Its companion website also offers ordinary MP4 inspection. Playback page and media origin permissions are requested only as needed. The review sample does not use third-party video.

## 权限说明

| 权限 | 用途 |
| --- | --- |
| activeTab | 用户主动点工具栏图标时，临时读取当前播放标签页。 |
| scripting | 在获准的播放页检查媒体元素和近期媒体资源；不常驻注入到任意站点。 |
| storage | 在扩展的会话存储里把一次检测结果交给本地下载面板。 |
| alarms | 定期清理浏览器私有存储里已过期的临时媒体文件。 |
| optional HTTPS host access | 播放页或媒体 CDN 可能不同，仅在任务需要时请求选中来源，不在安装时授予所有网站读取权限。 |
| 站点桥接 | 内容脚本只注入 DownloadAny 的 HTTPS 预览入口及预留的正式入口。上架包没有 localhost 内容脚本或 HTTP 回环权限。 |

单一用途：识别并保存用户有权下载的 MP4 和未加密 HLS 视频。所有执行代码随扩展包分发，不从网络下载并执行扩展代码。

隐私申报要区分本机处理和网页服务：扩展在本机读取播放页 URL、媒体请求和文件，媒体从原站直接获取；网页静态解析将用户主动提交的网址发给 Cloudflare Worker，且 IP 地址用于限流。不得把这个组合笼统表述成“从不处理 URL 或网络信息”。

发布者需在平台页面核对数据声明、协议及公开联系信息。此文件是填写材料，不是已提交或已审核的记录。
