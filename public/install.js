const byId = (id) => document.getElementById(id);

function releaseLinks(beta) {
  if (!beta || !['owner', 'repository', 'tag', 'asset'].every((key) => typeof beta[key] === 'string')
    || !/^[a-z\d-]+$/i.test(beta.owner) || !/^[a-z\d_-]+$/i.test(beta.repository)
    || !/^v\d+\.\d+\.\d+-beta\.\d+$/.test(beta.tag) || !/^[a-z\d_.-]+\.zip$/i.test(beta.asset)) {
    throw new Error('Invalid beta release metadata');
  }
  const base = 'https://github.com/' + beta.owner + '/' + beta.repository + '/releases';
  return { page: base + '/tag/' + beta.tag, download: base + '/download/' + beta.tag + '/' + beta.asset };
}

function storeUrl(raw, host, prefix) {
  try {
    const url = new URL(raw);
    if (url.origin === 'https://' + host && !url.username && !url.password
      && url.pathname.startsWith(prefix) && url.pathname.length > prefix.length) return url.href;
  } catch { /* not published or not a store listing */ }
}

function showStore(browser, url) {
  if (!url) return;
  const link = byId(browser + '-store');
  link.href = url;
  link.hidden = false;
  byId(browser + '-status').hidden = true;
}

void (async () => {
  try {
    const response = await fetch('/install-config.json');
    if (!response.ok) throw new Error('Missing release metadata');
    const config = await response.json();
    const links = releaseLinks(config.beta);
    const download = byId('zip-download');
    download.href = links.download;
    download.hidden = false;
    byId('release-link').href = links.page;
    byId('beta-version').textContent = config.beta.tag;
    byId('release-status').textContent = '更新 Beta 时，先停用旧版，再解压并加载新版，避免两个版本同时运行。';
    showStore('edge', storeUrl(config.stores?.edge, 'microsoftedge.microsoft.com', '/addons/detail/'));
    showStore('chrome', storeUrl(config.stores?.chrome, 'chromewebstore.google.com', '/detail/'));
  } catch {
    byId('release-status').textContent = '未能加载发布信息，可以从 GitHub 发布记录下载。';
  }
})();

for (const button of document.querySelectorAll('button[data-copy]')) {
  button.addEventListener('click', async () => {
    const address = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(address);
      byId('copy-status').textContent = '已复制 ' + address;
    } catch {
      byId('copy-status').textContent = '请手动复制 ' + address + ' 并粘贴到地址栏。';
    }
  });
}
