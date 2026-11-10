const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = esbuild.buildSync({
  stdin: {
    contents: [
      'credentials', 'confluenceApi', 'markRunner', 'markInstaller', 'configurationPanel',
    ].map(name => `export * from './src/${name}';`).join('\n'),
    resolveDir: path.resolve(__dirname, '..'),
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'],
}).outputFiles[0].text;

function fixture(settings = {}, options = {}) {
  const state = {
    settings: { ...settings }, updates: [], secrets: new Map(), logs: '', spawned: [], requests: [],
    replies: [], copied: [], removed: [], executions: [], downloads: [], status: 200,
    ...options,
  };
  const config = {
    get: (key, fallback) => state.settings[key] ?? fallback,
    inspect: key => ({ globalValue: state.settings[key] }),
    update: async (key, value, target) => {
      state.updates.push({ key, value, target });
      if (value === undefined) delete state.settings[key];
      else state.settings[key] = value;
    },
  };
  const storage = {
    get: async key => state.secrets.get(key),
    store: async (key, value) => state.secrets.set(key, value),
  };
  const panel = {
    reveal: () => { state.revealed = true; },
    onDidDispose: callback => { state.dispose = callback; },
    webview: {
      html: '',
      onDidReceiveMessage: callback => { state.receive = callback; return { dispose() {} }; },
      postMessage: async message => { state.replies.push(message); return true; },
    },
  };
  const vscode = {
    workspace: { getConfiguration: () => config, workspaceFolders: [{}], isTrusted: options.trusted !== false },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ViewColumn: { One: 1 }, ProgressLocation: { Notification: 15 },
    Uri: { parse: value => value },
    env: { openExternal: async url => { state.external = url; } },
    window: {
      createWebviewPanel: () => panel,
      createOutputChannel: () => ({
        append: text => { state.logs += text; },
        appendLine: text => { state.logs += `${text}\n`; },
        show: () => { state.outputShown = true; }, dispose() {},
      }),
      showWarningMessage: async () => state.cancel ? undefined : 'Installer',
      showOpenDialog: async () => state.selection,
      withProgress: async (_options, callback) => callback({ report() {} }),
    },
  };
  const childProcess = {
    spawn: (executable, args, spawnOptions) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = value => { state.stdin = value; };
      state.spawned.push({ executable, args, options: spawnOptions });
      process.nextTick(() => {
        if (state.spawnError) { child.emit('error', new Error(state.spawnError)); }
        else {
          const output = state.stderr || '';
          child.stderr.emit('data', Buffer.from(output.slice(0, 5)));
          child.stderr.emit('data', Buffer.from(output.slice(5)));
        }
        child.emit('close', state.exitCode ?? 0);
      });
      return child;
    },
    execFile: (executable, args, execOptions, callback) => {
      state.executions.push({ executable, args, options: execOptions });
      callback(state.execError ? new Error(state.execError) : null, 'mark v17.0.0', '');
    },
  };
  const transport = {
    request: (requestOptions, callback) => {
      state.requests.push(requestOptions);
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = () => {};
      request.end = () => process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = state.status;
        callback(response);
        response.emit('data', state.body || JSON.stringify({ results: [], size: 0 }));
        response.emit('end');
      });
      return request;
    },
  };
  const filesystem = {
    mkdtemp: async () => path.join(require('node:os').tmpdir(), 'vcmd2conf-test'),
    readFile: async (value, encoding) => require('node:fs/promises').readFile(value, encoding),
    writeFile: async () => {},
    lstat: async () => ({ isFile: () => true }),
    chmod: async () => {}, mkdir: async () => {},
    copyFile: async (from, to) => { state.copied.push({ from, to }); },
    rm: async value => { state.removed.push(value); },
  };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, Buffer, URL, AbortSignal, console,
    process: { ...process, platform: state.platform || process.platform, arch: state.arch || process.arch },
    fetch: async url => {
      state.downloads.push(url);
      const body = state.responses?.[url];
      if (body === undefined) throw new Error(`Unexpected download: ${url}`);
      return { ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(body) };
    },
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'child_process') return childProcess;
      if (name === 'http' || name === 'https') return transport;
      if (name === 'fs/promises') return filesystem;
      return require(name);
    },
  };
  vm.runInNewContext(source, sandbox);
  const api = module.exports;
  const context = { secrets: storage, subscriptions: [], globalStorageUri: { fsPath: path.join(require('node:os').tmpdir(), 'vcmd2conf-storage') } };
  return { api, state, storage, context, panel };
}

test('PAT moves to SecretStorage and remains available to both clients', async () => {
  const { api, state, storage } = fixture({ apiToken: 'legacy-token' });
  await api.initializeCredentials(storage);
  assert.equal(api.getApiToken(), 'legacy-token');
  await api.saveApiToken('secure-token');
  assert.equal(state.secrets.get('vcmd2conf.apiToken'), 'secure-token');
  assert.equal(state.settings.apiToken, undefined);
  assert.equal(api.getApiToken(), 'secure-token');
  await api.saveApiToken('');
  assert.equal(api.getApiToken(), '');
});

test('API preserves /wiki and uses Basic or Bearer authentication', async () => {
  for (const username of ['', 'user@example.test']) {
    const { api, state, storage } = fixture({ baseUrl: 'https://example.test/wiki/', username, apiToken: 'test-token' });
    await api.initializeCredentials(storage);
    const result = await new api.ConfluenceApi().testConnection();
    assert.equal(result.success, true);
    assert.equal(state.requests[0].path, '/wiki/rest/api/space?limit=1');
    assert.equal(state.requests[0].headers.Authorization, username
      ? `Basic ${Buffer.from(`${username}:test-token`).toString('base64')}` : 'Bearer test-token');
  }
});

test('connection errors include actionable HTTP diagnostics without secrets', async () => {
  const { api, state, storage } = fixture({ baseUrl: 'https://example.test/wiki', apiToken: 'test-token' });
  await api.initializeCredentials(storage);
  state.status = 401;
  const result = await new api.ConfluenceApi().testConnection();
  assert.equal(result.success, false);
  assert.match(result.message, /HTTP 401/);
  assert.doesNotMatch(result.message, /test-token/);
});

test('file and folder publishing use stdin, preserve spaced paths, and redact split secrets', async () => {
  for (const operation of ['syncFile', 'syncFolder']) {
    const { api, state, storage } = fixture({
      markPath: 'C:/Program Files/mark/mark.exe', apiToken: 'test-token', defaultSpace: 'DOCS',
    }, { stderr: 'test-token authentication failed', exitCode: 1 });
    await api.initializeCredentials(storage);
    const result = await api[operation]('C:/docs/test document.md');
    assert.equal(result.success, false);
    assert.equal(state.spawned[0].options.shell, false);
    assert.equal(state.spawned[0].executable, 'C:/Program Files/mark/mark.exe');
    assert.equal(state.spawned[0].args.includes('test-token'), false);
    assert.equal(state.stdin, 'test-token\n');
    assert.equal(state.spawned[0].args.includes('--space'), true);
    assert.doesNotMatch(state.logs, /test-token/);
    assert.doesNotMatch(result.stderr, /test-token/);
    assert.match(api.describeMarkError(result), /Code de sortie : 1/);
  }
});

test('file and folder publishing enable H1 titles without conflicting filename titles', async () => {
  for (const operation of ['syncFile', 'syncFolder']) {
    for (const settings of [{}, { markConfigPath: 'C:/my config/mark.toml' }]) {
      const { api, state } = fixture(settings);
      await api[operation]('C:/docs/test document.md');
      const args = state.spawned[0].args;
      assert.ok(args.includes('--title-from-h1'), `${operation} must include --title-from-h1`);
      assert.ok(args.indexOf('--title-from-h1') > args.indexOf('publish'));
      assert.equal(args.includes('--title-from-filename'), false);
    }
  }
});

test('file and folder publishing always enable YAML frontmatter', async () => {
  for (const operation of ['syncFile', 'syncFolder']) {
    for (const [settings, expectedFeatures] of [
      [{}, '--features=frontmatter'],
      [{ markFeatures: 'mermaid' }, '--features=mermaid,frontmatter'],
      [{ markFeatures: 'frontmatter,mermaid' }, '--features=frontmatter,mermaid'],
    ]) {
      const { api, state } = fixture(settings);
      await api[operation]('C:/docs/test document.md');
      assert.equal(state.spawned[0].args.includes(expectedFeatures), true);
    }
  }
});

test('file frontmatter space takes precedence over the configured default space', async () => {
  const { api, state } = fixture({ defaultSpace: 'Allombert Beatrice' });
  const filePath = path.resolve(__dirname, '..', 'docs', 'This is a test.md');

  await api.syncFile(filePath);

  assert.equal(state.spawned[0].args.includes('--space'), false);
  assert.equal(state.spawned[0].args.includes('Allombert Beatrice'), false);
});

test('mark config file retains authentication priority', async () => {
  const { api, state, storage } = fixture({ markConfigPath: 'C:/my config/mark.toml', apiToken: 'test-token' });
  await api.initializeCredentials(storage);
  await api.syncFile('C:/docs/test.md');
  assert.equal(state.spawned[0].args[1], 'C:/my config/mark.toml');
  assert.equal(state.spawned[0].args.includes('-p'), false);
  assert.equal(state.stdin, undefined);
});

test('missing executable and version failures provide useful errors', async () => {
  const { api, state } = fixture({}, { spawnError: 'ENOENT', execError: 'ENOENT' });
  const result = await api.syncFile('test.md');
  assert.equal(result.exitCode, -1);
  assert.match(api.describeMarkError(result), /introuvable/);
  assert.equal((await api.inspectMark()).success, false);
  api.showMarkOutput();
  assert.equal(state.outputShown, true);
});

test('asset selection handles official names and rejects unsupported targets', () => {
  const { api } = fixture();
  const assets = ['mark_Darwin_arm64.tar.gz', 'mark_Darwin_x86_64.tar.gz', 'mark_Linux_arm64.tar.gz', 'mark_Linux_x86_64.tar.gz', 'mark_Windows_x86_64.zip']
    .map(name => ({ name }));
  assert.equal(api.selectMarkAsset(assets, 'darwin', 'arm64').name, 'mark_Darwin_arm64.tar.gz');
  assert.equal(api.selectMarkAsset(assets, 'darwin', 'x64').name, 'mark_Darwin_x86_64.tar.gz');
  assert.equal(api.selectMarkAsset(assets, 'linux', 'x64').name, 'mark_Linux_x86_64.tar.gz');
  assert.equal(api.selectMarkAsset(assets, 'linux', 'arm64').name, 'mark_Linux_arm64.tar.gz');
  assert.equal(api.selectMarkAsset(assets, 'win32', 'x64').name, 'mark_Windows_x86_64.zip');
  assert.throws(() => api.selectMarkAsset([], 'win32', 'x64'), /Aucun binaire/);
});

function releaseResponses(platform, validChecksum = true) {
  const archive = Buffer.from('fake-release-archive');
  const base = 'https://github.com/kovetskiy/mark/releases/download/v17.0.0/';
  const name = 'mark_Linux_x86_64.tar.gz';
  const assets = platform === 'win32' ? [] : [name, 'checksums.txt'].map(name => ({ name, browser_download_url: base + name }));
  return {
    'https://api.github.com/repos/kovetskiy/mark/releases/latest': JSON.stringify({ tag_name: 'v17.0.0', assets }),
    [base + name]: archive,
    [base + 'checksums.txt']: `${validChecksum ? createHash('sha256').update(archive).digest('hex') : 'invalid'}  ${name}`,
  };
}

test('Linux installer verifies checksum, extracts only mark and cleans temporary files', async () => {
  const { api, state, context } = fixture({}, { platform: 'linux', arch: 'x64', responses: releaseResponses('linux') });
  const installed = await api.installMark(context);
  assert.equal(path.basename(installed), 'mark');
  assert.equal(state.executions[0].executable, 'tar');
  assert.equal(state.executions[0].args.at(-1), 'mark');
  assert.equal(state.copied.length, 1);
  assert.equal(state.removed.length, 1);
});

test('bad checksum blocks extraction and execution', async () => {
  const { api, state, context } = fixture({}, { platform: 'linux', arch: 'x64', responses: releaseResponses('linux', false) });
  await assert.rejects(api.installMark(context), /SHA-256/);
  assert.equal(state.executions.length, 0);
  assert.equal(state.copied.length, 0);
  assert.equal(state.removed.length, 1);
});

test('Windows without official archive uses Go with a private GOBIN', async () => {
  const { api, state, context } = fixture({}, { platform: 'win32', arch: 'x64', responses: releaseResponses('win32') });
  const installed = await api.installMark(context);
  assert.equal(path.basename(installed), 'mark.exe');
  assert.equal(state.executions[0].executable, 'go');
  assert.equal(state.executions[0].args[1], 'github.com/kovetskiy/mark/v17/cmd/mark@v17.0.0');
  assert.ok(path.isAbsolute(state.executions[0].options.env.GOBIN));
  assert.equal(state.removed.length, 1);
});

test('installer does not download on cancellation or in untrusted workspaces', async () => {
  const cancelled = fixture({}, { cancel: true });
  assert.equal(await cancelled.api.installMark(cancelled.context), undefined);
  assert.equal(cancelled.state.downloads.length, 0);
  const untrusted = fixture({}, { trusted: false });
  await assert.rejects(untrusted.api.installMark(untrusted.context), /approuve/);
  assert.equal(untrusted.state.downloads.length, 0);
});

test('configuration escapes settings and never embeds the stored PAT', async () => {
  const { api, panel, context, storage, state } = fixture({ baseUrl: '"><script>alert(1)</script>', apiToken: 'test-token' });
  await api.initializeCredentials(storage);
  api.openConfiguration(context, new api.ConfluenceApi());
  assert.doesNotMatch(panel.webview.html, /test-token/);
  assert.match(panel.webview.html, /&quot;&gt;&lt;script&gt;/);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.doesNotMatch(panel.webview.html, /style="/);
  if (process.env.VCMD2CONF_PREVIEW_PATH) {
    const preview = fixture({
      baseUrl: 'https://example.atlassian.net/wiki', username: 'user@example.test', apiToken: 'test-token', markFeatures: 'mermaid',
    });
    await preview.api.initializeCredentials(preview.storage);
    preview.api.openConfiguration(preview.context, new preview.api.ConfluenceApi());
    require('node:fs').writeFileSync(process.env.VCMD2CONF_PREVIEW_PATH, preview.panel.webview.html);
  }
  const script = panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  await state.receive({ action: 'logs' });
  assert.equal(state.outputShown, true);
});

test('configuration saves a replacement PAT, preserves a blank field, and deletes explicitly', async () => {
  const { api, context, storage, state } = fixture({ baseUrl: 'https://example.test/wiki', apiToken: 'legacy-token' });
  await api.initializeCredentials(storage);
  api.openConfiguration(context, new api.ConfluenceApi());
  const values = { baseUrl: 'https://example.test/wiki/', username: '', markPath: 'mark', apiToken: 'new-token' };
  await state.receive({ action: 'save', values });
  assert.equal(api.getApiToken(), 'new-token');
  assert.equal(state.settings.apiToken, undefined);
  assert.equal(state.settings.baseUrl, 'https://example.test/wiki');
  assert.equal(state.replies.at(-1).success, true);
  await state.receive({ action: 'test', values: { ...values, apiToken: '' } });
  assert.equal(api.getApiToken(), 'new-token');
  assert.equal(state.requests[0].headers.Authorization, 'Bearer new-token');
  await state.receive({ action: 'save', values: { ...values, apiToken: '', removeToken: true } });
  assert.equal(api.getApiToken(), '');
  assert.equal(state.replies.at(-1).hasToken, false);
});

test('configuration rejects credential-bearing URLs before persisting settings', async () => {
  const { api, context, state } = fixture();
  api.openConfiguration(context, new api.ConfluenceApi());
  await state.receive({ action: 'save', values: { baseUrl: 'https://user:secret@example.test', markPath: 'mark' } });
  assert.equal(state.replies.at(-1).success, false);
  assert.equal(state.updates.length, 0);
});

test('Windows installation explains missing Go and cleans temporary files', async () => {
  const { api, state, context } = fixture({}, {
    platform: 'win32', arch: 'x64', responses: releaseResponses('win32'), execError: 'ENOENT',
  });
  await assert.rejects(api.installMark(context), /Installez Go/);
  assert.equal(state.copied.length, 0);
  assert.equal(state.removed.length, 1);
});

test('API redacts tokens echoed by an HTTP error', async () => {
  const { api, state, storage } = fixture({ baseUrl: 'https://example.test/wiki', apiToken: 'test-token' });
  await api.initializeCredentials(storage);
  state.status = 500;
  state.body = 'Error for test-token';
  const result = await new api.ConfluenceApi().testConnection();
  assert.equal(result.success, false);
  assert.doesNotMatch(result.message, /test-token/);
});