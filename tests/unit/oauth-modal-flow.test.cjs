const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parse } = require('@babel/parser');

const source = fs.readFileSync(require('node:path').join(__dirname, '../../src/shared/components/OAuthModal.js'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration;
const declaration = component.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'startOAuthFlow');
const callback = declaration.declarations[0].init.arguments[0];

for (const provider of ['codex', 'xai', 'claude', 'github', 'kiro', 'qoder']) {
  test(`${provider} starts the correct OAuth flow`, async () => {
    const requests = [], opened = [], polls = [], errors = [];
    let authData;
    const device = ['github', 'kiro', 'qoder'].includes(provider);
    const context = {
      URL, provider, isLocalhost: true, oauthMeta: null, idcConfig: null,
      authMode: 'browser', PROXY_OAUTH_PROVIDERS: new Set(), popupRef: {},
      setError: error => { if (error) errors.push(error); },
      setStep() {}, setIsDeviceCode() {}, setDeviceData() {},
      setAuthData: data => { authData = data; },
      startPolling: (...args) => polls.push(args),
      window: { location: new URL('http://localhost:20128'), open: url => { opened.push(url); return {}; } },
      fetch: async url => {
        requests.push(new URL(url, 'http://localhost:20128'));
        return { ok: true, json: async () => ({
          authUrl: 'https://auth.openai.com/oauth/authorize', state: 'test-state', codeVerifier: 'test-verifier',
          success: true, serverSide: true, device_code: 'test-device', verification_uri: 'https://example.com/device',
        }) };
      },
    };
    await vm.runInNewContext(`(${source.slice(callback.start, callback.end)})()`, context);
    assert.deepEqual(errors, []);
    assert.equal(requests[0]?.pathname, `/api/oauth/${provider}/${device ? 'device-code' : 'authorize'}`);
    assert.equal(opened.length, 1);
    assert.equal(polls.length, device ? 1 : 0);
    if (provider === 'codex') {
      assert.equal(authData.redirectUri, 'http://localhost:1455/auth/callback');
      assert.equal(authData.codexServerSide, true);
      assert.equal(requests[1].pathname, '/api/oauth/codex/start-proxy');
    }
  });
}
