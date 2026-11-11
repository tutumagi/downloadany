# DownloadAny MP4 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development. Verify each task locally before committing.

**Goal:** Ship a locally verifiable browser app that finds and saves MP4s from supported direct links and static web pages.

**Architecture:** A small TypeScript client and a Cloudflare Worker share a typed response contract. Static demo assets provide deterministic examples for both download paths; the Worker fetches only configured external hosts and explicitly permitted same-origin demo paths.

**Tech Stack:** TypeScript, Vite, Wrangler, HTMLRewriter, Node test runner, browser smoke tests.

**Spec:** [Web design](../specs/2026-11-11-downloadany-web-design.md).

## Constraints and review focus

No remote deployment in the local-first handoff, no third-party platform adapters, no DNS changes or video proxy. HTML reads stop at 1 MiB, the total inspection budget is 8 seconds, redirect depth is three, and ten candidates are returned at most. Never download a whole media file server-side. The browser CORS path limits reads to 25 MiB. Ensure redirects never escape the allowed origins, four recognized platforms are reported as closed before fetching, HEAD-only positives do not advertise downloads, duplicate media references are not repeated, and cross-origin playback alone does not count as a successful download.

## Task 1: Build and inspect

- [ ] Add project tooling and Node tests for the URL policy and GET-based MP4 delivery classification. Run tests with the features still absent.
- [ ] Implement the contract in `src/shared.ts`, URL policy in `src/worker/policy.ts`, and MP4 header classification in `src/worker/media.ts`. Add bounded fetch and HTML scanning in `src/worker/inspect.ts`, with HTTP routing in `src/worker/index.ts`.
- [ ] Add self-hosted demo assets and run integration cases for direct links, relative URLs, distinct videos, deduplication, timeout/limit handling, and source restrictions. Run type and build checks.

## Task 2: Browser workflow and handoff

- [ ] Add a browser test for filling the sample link, inspecting a page, downloading MP4 bytes, and surfacing closed-platform errors. Run it against the local server before the UI exists.
- [ ] Build a responsive, keyboard-accessible form and result list in `index.html` and `src/web/`. Distinguish downloading from opening the source and show a retry action for transient errors.
- [ ] Verify both attachment and CORS delivery, the actual saved media files, small-screen layout, and Wrangler's build configuration. Document run commands, supported hosts, Git Flow and the later workers.dev rollout.
- [ ] Review the implementation, commit on the feature branch, and integrate the verified feature into `develop` locally.
