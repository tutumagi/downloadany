#!/usr/bin/env python3
"""Pack the shared Edge Add-ons / Chrome Web Store MV3 build."""
import json
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
source = root / "dist-extension"
manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
zh = {
    "extensionName": {"message": manifest["name"]},
    "extensionDescription": {"message": manifest["description"]},
    "extensionActionTitle": {"message": manifest["action"]["default_title"]},
}
en = {
    "extensionName": {"message": "DownloadAny · Playback Video Saver"},
    "extensionDescription": {"message": "Identify MP4 and unencrypted HLS in a selected playback tab and save it locally."},
    "extensionActionTitle": {"message": "DownloadAny · Identify video in this tab"},
}
manifest["default_locale"] = "zh_CN"
manifest["name"] = "__MSG_extensionName__"
manifest["description"] = "__MSG_extensionDescription__"
manifest["action"]["default_title"] = "__MSG_extensionActionTitle__"
manifest["optional_host_permissions"] = [
    entry for entry in manifest["optional_host_permissions"] if entry.startswith("https://")
]
for script in manifest["content_scripts"]:
    script["matches"] = [entry for entry in script["matches"] if entry.startswith("https://")]
if sys.argv[1:] == ["--beta"]:
    beta = json.loads((root / "public" / "install-config.json").read_text(encoding="utf-8"))["beta"]
    tag = beta["tag"]
    expected_prefix = f"v{manifest['version']}-beta."
    assert tag.startswith(expected_prefix) and tag[len(expected_prefix):].isdigit(), "beta tag and extension version differ"
    assert beta["asset"] == f"DownloadAny-{tag[1:]}.zip", "unexpected beta asset name"
    output = source / beta["asset"]
else:
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else source / f"DownloadAny-{manifest['version']}-stores.zip"
output.parent.mkdir(parents=True, exist_ok=True)

names = {
    manifest["background"]["service_worker"],
    "manager.html", "manager.js", *manifest["icons"].values(),
    *(entry for script in manifest["content_scripts"] for entry in script["js"]),
}
files = [source / name for name in sorted(names)]
files.extend(sorted(p for p in (source / "assets").iterdir() if p.is_file() and p.suffix in {".js", ".css"}))
licenses = []
for name in ("mux.js", "@babel/runtime", "global", "min-document", "process"):
    package = root / "node_modules" / name
    if not package.is_dir():
        continue
    for p in sorted(package.iterdir()):
        if p.is_file() and p.name.upper().startswith(("LICENSE", "NOTICE")):
            licenses.append((name, p))
assert any(name == "mux.js" for name, _ in licenses), "mux.js license missing"

with ZipFile(output, "w", ZIP_DEFLATED) as bundle:
    bundle.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    for locale, messages in (("zh_CN", zh), ("en", en)):
        bundle.writestr(f"_locales/{locale}/messages.json", json.dumps(messages, indent=2, ensure_ascii=False) + "\n")
    for p in files:
        bundle.write(p, p.relative_to(source).as_posix())
    for name, p in licenses:
        bundle.write(p, f"licenses/{name}/{p.name}")

with ZipFile(output) as bundle:
    assert bundle.testzip() is None
    assert json.loads(bundle.read("manifest.json")) == manifest
    assert json.loads(bundle.read("_locales/zh_CN/messages.json")) == zh
    assert json.loads(bundle.read("_locales/en/messages.json")) == en
    assert all(bundle.read(p.relative_to(source).as_posix()) == p.read_bytes() for p in files)
print(output)
