export interface AuthorizePageInput {
  clientId: string;
  error?: string;
  githubEnabled: boolean;
  apiKeyEnabled: boolean;
  oauthParams: string;
  formValues: OAuthFormValues;
}

export interface OAuthFormValues {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
}

export function renderAuthorizePage(input: AuthorizePageInput): string {
  const githubButton = input.githubEnabled ? `
    <a href="/oauth/github/start?${input.oauthParams}" class="github-btn">
      <svg height="20" viewBox="0 0 16 16" width="20" fill="currentColor" style="vertical-align:middle;margin-right:8px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Sign in with GitHub
    </a>` : '';

  const divider = input.githubEnabled && input.apiKeyEnabled ? `<div class="divider"><span>or</span></div>` : '';
  const apiKeyForm = input.apiKeyEnabled ? renderApiKeyForm(input.formValues, !!input.error) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize - backlog-mcp</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 1.3rem; margin-bottom: 4px; }
    p { color: #555; font-size: 0.95rem; margin-bottom: 24px; }
    label { display: block; font-size: 0.9rem; margin-bottom: 6px; font-weight: 500; }
    input[type=password] { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
    button, .github-btn { display: flex; align-items: center; justify-content: center; margin-top: 16px; width: 100%; padding: 11px; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; text-decoration: none; box-sizing: border-box; }
    button { background: #2563eb; color: #fff; }
    button:hover { background: #1d4ed8; }
    .github-btn { background: #24292e; color: #fff; }
    .github-btn:hover { background: #1a1e22; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #999; font-size: 0.85rem; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
    .error { color: #dc2626; font-size: 0.9rem; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Authorize backlog-mcp</h1>
  <p><strong>${escapeHtml(input.clientId || 'A client')}</strong> is requesting access to your backlog.</p>
  ${githubButton}
  ${divider}
  ${apiKeyForm}
</body>
</html>`;
}

export function authErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth Error - backlog-mcp</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;color:#111;}h1{font-size:1.3rem;color:#dc2626;}p{color:#555;font-size:0.95rem;}</style></head><body><h1>Authorization Failed</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function renderApiKeyForm(values: OAuthFormValues, hasError: boolean): string {
  return `
    <form method="POST" action="/authorize">
      <input type="hidden" name="response_type" value="${escapeAttr(values.responseType)}">
      <input type="hidden" name="client_id" value="${escapeAttr(values.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeAttr(values.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeAttr(values.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeAttr(values.codeChallengeMethod)}">
      <input type="hidden" name="state" value="${escapeAttr(values.state)}">
      <input type="hidden" name="scope" value="${escapeAttr(values.scope)}">
      <label for="password">API Key</label>
      <input type="password" id="password" name="password" autofocus placeholder="Your API key">
      ${hasError ? `<p class="error">Invalid API key. Try again.</p>` : ''}
      <button type="submit">Authorize with API Key</button>
    </form>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
