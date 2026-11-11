# DownloadAny HLS browser extension implementation

**Goal:** Add a locally installable Chromium extension that saves eligible HLS videos from the currently playing tab. The existing Workers web app stays focused on MP4 links and static pages.

**Decision:** A Worker can parse pages without installing anything, but it cannot observe the user's current playback tab. A local extension can do that after the user clicks it, and has no need to send video or links to Workers. Use Manifest V3 and mux.js, with a separate extension build.

1. Detect HLS and DASH in the active tab after the user invokes the extension. Transfer only recent candidates to the local extension UI, once. Use observed URLs without modifying or exporting them. Fetch HLS with credentials omitted, no referrer, and no redirects. Optional host access is requested only for a selected source.
2. Parse complete, clear HLS VOD. Support a multiplexed media playlist or one level of master playlist variants. Support MPEG-TS remux and fMP4 fragments with one initialization file. Reject encryption, live playback, split audio, discontinuities, byte ranges, and playlist or segment URLs on a different origin. Detect DASH and explain that export is unavailable in this version.
3. Stream the output to browser-private temporary storage, then offer the file with a user-initiated save. Set manifest, segment, total output, and time limits. Keep the original tabs and Cloudflare configuration untouched.
4. Verify with synthetic H.264/AAC HLS fixtures in Node and Chromium. Require a playable downloaded MP4 with both audio and video; test that encrypted playlists do not fetch keys or segments. Document installation and keep the Gaotu replay as a separate live acceptance case. Do not claim site support without saving that replay.

The grouped HLS/M3U8/DASH reply confirms segmented media but does not distinguish HLS from DASH. HLS export is the first local increment; DASH detection makes a real DASH replay failure actionable.
