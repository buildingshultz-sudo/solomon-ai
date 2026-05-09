# Deployment Guide — Solomon 2.0 on a VPS

This guide walks through getting Solomon running on a **fresh $5–$20/month Linux VPS**
(DigitalOcean, Hetzner, Vultr, Linode — anything that gives you root and Docker). The
target is a single-host deployment that can autonomously run 24/7.

If you'd rather run it on Jed's PC or a home lab box, the same steps work — skip the
DNS/SSL bits.

---

## 0. What you'll end up with

```
                      ┌──────────────────────────────────┐
                      │  https://solomon.your-domain.com │
                      └──────────────────────────────────┘
                                       │
                                       ▼
              ┌────────────────────── Caddy ─────────────────────┐
              │  Auto TLS · reverse proxy to localhost:3000      │
              └──────────────────────────────────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
              ┌──────────────────────┐    ┌──────────────────────┐
              │   solomon-app:3000   │    │   solomon-db:3306    │
              │  Node 22 · tRPC      │    │  MySQL 8 · volume    │
              │  Vite-built static   │    │                      │
              └──────────────────────┘    └──────────────────────┘
```

A single `docker compose up -d` brings the app and database up. Caddy on the host
terminates TLS and proxies to the container. Restart policies pin everything to
`unless-stopped` so a reboot brings Solomon back automatically.

---

## 1. Provision the VPS

Pick anything with **≥1 GB RAM, 1 vCPU, 25 GB SSD**. The Hetzner CX22 (€4.51/mo) and
DigitalOcean's $6 droplet are both proven targets.

1. Create the VPS with a recent **Ubuntu 24.04 LTS** image.
2. SSH in as root, then create a non-root user and disable password login:
   ```bash
   adduser jed && usermod -aG sudo jed
   rsync --archive --chown=jed:jed ~/.ssh /home/jed
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```
3. Open a firewall:
   ```bash
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
   ```

---

## 2. Install Docker and Caddy

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Caddy (for automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

---

## 3. Clone Solomon and configure secrets

```bash
git clone https://github.com/buildingshultz-sudo/solomon-ai.git
cd solomon-ai
cp .env.example .env
$EDITOR .env
```

Required values:

| Variable | What goes here |
|---|---|
| `DATABASE_URL` | `mysql://solomon:<strong-password>@db:3306/solomon` (matches docker-compose) |
| `MYSQL_ROOT_PASSWORD` | Strong password for MySQL's root account |
| `MYSQL_PASSWORD` | Same value used in `DATABASE_URL` |
| `OPENAI_API_KEY` | Your OpenAI key — this is what Solomon's brain runs on |
| `JWT_SECRET` | Output of `openssl rand -hex 32` |
| `PORT` | `3000` |

Optional integration keys can be left blank and added later through the `/settings`
page; the corresponding tools simply run in stub mode until you fill them in.

---

## 4. Bring it up

```bash
docker compose up -d --build
```

Compose runs the app, MySQL, and applies migrations on startup. First boot takes ~60
seconds because the multi-stage Docker build compiles the Vite bundle. You can tail
logs with `docker compose logs -f app`.

Sanity check:

```bash
curl -fsS http://localhost:3000/api/trpc/system.health 2>/dev/null | head -c 200
docker compose exec app pnpm test
```

---

## 5. Front it with Caddy + HTTPS

Point an `A` record at the VPS public IP, e.g. `solomon.example.com`. Then put this in
`/etc/caddy/Caddyfile`:

```caddyfile
solomon.example.com {
    encode zstd gzip
    reverse_proxy localhost:3000
}
```

Reload:

```bash
sudo systemctl reload caddy
```

You should now get a valid Let's Encrypt certificate within seconds and the dashboard
should load over HTTPS.

---

## 6. Disabling Manus OAuth (optional, fully self-hosted mode)

The repo's auth path defaults to the platform's OAuth provider so it works
out-of-the-box on Manus. If you want **zero external dependencies**, swap to a static
single-user mode by editing `server/_core/oauth.ts`:

1. Replace the OAuth callback with a small handler that issues a JWT for a hard-coded
   `OWNER_OPEN_ID` after a constant-time password check.
2. Add `OWNER_PASSWORD` to your `.env`.
3. Remove the `Login with Manus` button and replace it with a small login form on
   `client/src/pages/Login.tsx`.

This is intentionally left as a one-time fork: the rest of Solomon (sessions, RBAC,
the `protectedProcedure` middleware) is provider-agnostic.

---

## 7. Hooking up the integrations

For each external service, drop the credential into `/settings` and the corresponding
tool flips from `stub` to `success` automatically.

| Tool | Credential | How to get it |
|---|---|---|
| `youtube_analytics`, `youtube_upload` | `apikey.youtube` | Google Cloud Console → enable YouTube Data API v3 → OAuth client → exchange refresh token |
| `gmail_inbox`, `gmail_send` | `apikey.gmail_oauth` | Google Cloud Console → enable Gmail API → OAuth client (scopes: `gmail.readonly`, `gmail.send`) |
| `gdrive_list` | `apikey.gdrive_oauth` | Same Google Cloud project → enable Drive API → scope: `drive.readonly` |
| `social_post` (Facebook) | `apikey.facebook` | Meta for Developers → page access token |
| `social_post` (Instagram) | `apikey.instagram` | Meta Graph API → Instagram Business Account |
| `social_post` (TikTok) | `apikey.tiktok` | TikTok for Developers → Content Posting API → access token |

The tool implementations in `server/solomon/tools.ts` already contain the API calls —
you only need to provide credentials.

---

## 8. Backups

Solomon's entire state lives in two places:

- The **MySQL volume** (`solomon-db-data` in `docker-compose.yml`) — back this up.
- The **`.env`** file — back this up *separately* and off-host.

A daily dump is enough for a single-user system:

```bash
sudo tee /etc/systemd/system/solomon-backup.service >/dev/null <<'EOF'
[Unit]
Description=Solomon nightly DB dump

[Service]
Type=oneshot
WorkingDirectory=/home/jed/solomon-ai
ExecStart=/bin/sh -c 'docker compose exec -T db mysqldump -uroot -p"$$MYSQL_ROOT_PASSWORD" solomon | gzip > /home/jed/backups/solomon-$(date +%%F).sql.gz'
EOF

sudo tee /etc/systemd/system/solomon-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Run Solomon backup nightly

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl enable --now solomon-backup.timer
```

Off-host the `~/backups` directory however you prefer (`rclone` to B2/S3/GCS).

---

## 9. Updating Solomon

```bash
cd ~/solomon-ai
git pull
docker compose up -d --build
```

Drizzle migrations are applied on container start. Application memory and the database
both survive the restart.

---

## 10. Operating it

| What | Where |
|---|---|
| Talk to Solomon | `/` (Chat) |
| Watch the autonomous schedule | `/scheduler` — see last run, last result, run a job manually |
| Inspect what it knows | `/memory` |
| Run a tool by hand | `/tools` |
| Tighten or loosen routing | `/settings` → Routing tab → adjust the complexity threshold |
| Tail logs | `docker compose logs -f app` |
| Get into the database | `docker compose exec db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" solomon` |

That's it. Welcome to a Solomon you actually own.
