# Solomon MCP — HTTPS via nginx + Let's Encrypt

claude.ai's custom-connector UI requires an HTTPS URL — it rejects plain `http://` IP addresses. This doc covers the nginx reverse-proxy + Let's Encrypt setup that's already staged on the VPS, and the **one thing Jed still has to do** to flip it from HTTP to HTTPS.

## Current state (2026-06-01)

| Layer | Status |
|---|---|
| nginx 1.24 installed | ✅ |
| Reverse proxy config at `/etc/nginx/sites-available/solomon-mcp` + symlinked in `sites-enabled` | ✅ |
| `Authorization: Bearer …` header passthrough configured | ✅ verified end-to-end off-VPS |
| Streamable HTTP / SSE: `proxy_buffering off`, HTTP/1.1, Connection upgrade | ✅ |
| MCP server bound to `127.0.0.1:3002` (nginx is the only ingress) | ✅ |
| certbot 2.9 + python3-certbot-nginx installed | ✅ |
| **DNS A record `mcp.buildingshultz.com → 167.99.237.26`** | ⏳ **Jed must create this** |
| Let's Encrypt cert issued | ⏳ blocked on DNS |
| Auto-renew cron (`certbot --nginx` installs this automatically) | ⏳ blocked on DNS |

## The one thing Jed must do

Create a DNS **A record** at his DNS provider for `buildingshultz.com`:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `mcp` | `167.99.237.26` | 300 (5 min) is fine |

(So `mcp.buildingshultz.com` resolves to the VPS IP.)

Where the DNS lives — best guess: since `buildingshultz.com` currently points to `34.117.223.165` (Google Cloud / Squarespace), the DNS is probably managed at Squarespace or whoever Jed's domain registrar is. Login → DNS settings → Add record → A → host `mcp` → value `167.99.237.26`.

Propagation usually takes 1–5 minutes. Verify from any machine:

```bash
dig +short mcp.buildingshultz.com
# expected: 167.99.237.26
```

## Finish the HTTPS setup (one command, after DNS resolves)

On the VPS (Sam will do this in the next session, or Jed can run it himself):

```bash
certbot --nginx -d mcp.buildingshultz.com \
  --non-interactive --agree-tos -m buildingshultz@gmail.com --redirect
```

What it does:
1. Validates the domain via HTTP-01 challenge (uses the existing nginx config on port 80).
2. Issues a Let's Encrypt cert.
3. Auto-edits `/etc/nginx/sites-available/solomon-mcp` to add the `listen 443 ssl` block + cert paths + an HTTP→HTTPS redirect.
4. Reloads nginx.
5. Installs a systemd timer that auto-renews 30 days before expiry — verify with:
   ```bash
   certbot renew --dry-run
   ```

Then test from any off-VPS shell:

```bash
curl https://mcp.buildingshultz.com/health
# expect: {"ok":true,"app":"solomon-mcp",...}

curl -X POST https://mcp.buildingshultz.com/mcp \
     -H "Authorization: Bearer <token from .env>" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# expect: event: message\ndata: {"result":{"tools":[...]}}
```

## What was already verified (HTTP-only, via Host header)

These 3 smokes were run from an off-VPS shell against the VPS public IP with `-H "Host: mcp.buildingshultz.com"` to simulate the post-DNS state:

| Endpoint | Auth | Expected | Got |
|---|---|---|---|
| `GET /health` | none | 200 + JSON | ✅ 200 |
| `POST /mcp` | none | 401 | ✅ 401 |
| `POST /mcp` | `Bearer <token>` | 200 + tools/list | ✅ 200 |

So the proxy + bearer passthrough are wired correctly. The only thing missing is the SSL/TLS cert, and that's gated on DNS.

## Once HTTPS lives — Claude custom connector

In claude.ai → Settings → Custom connectors (or the project's connector list):

| Field | Value |
|---|---|
| Name | `Solomon MCP` (or any label) |
| URL | `https://mcp.buildingshultz.com/mcp` |
| Auth type | Bearer token |
| Token | `<MCP_SERVER_SECRET from /root/solomon-v4/.env>` (32-char base64url) |

Verify by sending the connected Claude session a request like "list your tools" — it should call `tools/list` and surface all 7.

## Where things live

- nginx config: `/etc/nginx/sites-available/solomon-mcp` (symlinked from `sites-enabled/`). Also committed to the repo at `nginx/solomon-mcp.conf` for posterity.
- MCP Node app: `/root/solomon-v4/mcp-server.js`, PM2 process `solomon-mcp`, listening on `127.0.0.1:3002`.
- Cert (after issuance): `/etc/letsencrypt/live/mcp.buildingshultz.com/fullchain.pem` + `privkey.pem`.
- Auto-renew: systemd timer `certbot.timer` (installed by the certbot package).
