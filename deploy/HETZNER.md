# Hosting weather.techx1.com on your Hetzner server

This runs the site next to news.techx1.com on the same server: Node runs the
app on a private port (3005), pm2 keeps it running, and nginx passes
weather.techx1.com traffic to it with HTTPS from Let's Encrypt.

If your server uses Caddy or Docker instead of nginx, say so and the steps
change slightly. The commands below assume Ubuntu or Debian and nginx.

> **Your server (2.28.52.229) uses Caddy in Docker, not nginx.** news.techx1.com
> runs as the `world-news` Docker containers, with `world-news-caddy-1` handling
> ports 80 and 443. The server firewall blocks containers from reaching apps on
> the host, so on this server the weather app runs as its own container on
> Caddy's Docker network instead of under pm2, and steps 4 to 6 are replaced by:
>
> ```
> NET=$(docker inspect world-news-caddy-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
> docker run -d --name irish-weather --restart unless-stopped --network $NET -v /root/irish-weather:/app -w /app -e PORT=3005 -e HOST=0.0.0.0 node:22-alpine node server.js
> ```
>
> then adding `deploy/Caddyfile-weather` to Caddy's Caddyfile and running
> `docker exec world-news-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
> Caddy sets up HTTPS itself. `deploy/update.sh` restarts the container.

## Will it clash with news.techx1.com?

No, you don't need another server. One server can run many sites. nginx
looks at the name in each visitor's request and sends weather.techx1.com to
the weather app and news.techx1.com to the news site. The two stay
separate as long as:

- **Each has its own port.** Weather uses 3005. Check nothing else uses it:
  `sudo ss -tlnp` lists every port in use, and the news site's app will be on
  one of them. If 3005 shows up, pick a free one (for example 3006) and change
  it in `deploy/ecosystem.config.js` and `deploy/nginx-weather.conf`.
- **Each has its own folder.** Weather goes in `/var/www/irish-weather`.
- **Each has its own pm2 name.** Weather runs as `irish-weather`; `pm2 status`
  shows both side by side.
- **Each has its own nginx file.** You add a new file for weather and don't
  edit the news one. `sudo nginx -t` checks both before anything is reloaded,
  so a mistake can't take the news site down.

## 1. Point weather.techx1.com at the server (GoDaddy)

1. In GoDaddy go to **My Products**, then **DNS** next to techx1.com.
2. Look at the existing **A** record for **news** and note its IP address.
3. Click **Add New Record**: Type **A**, Name **weather**, Value that same IP,
   TTL default. **Save**.

Do this first so DNS has time to update while you do the rest.

## 2. Log in and check Node

```bash
ssh root@YOUR_SERVER_IP          # or your usual user
node -v                          # needs v18 or newer
```

If Node is missing or older than 18:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Install pm2 if you don't already use it for the news site:

```bash
sudo npm install -g pm2
```

## 3. Get the code

```bash
cd /var/www                      # or wherever news.techx1.com lives
sudo git clone https://github.com/jimmyvr5-ai/Irish_Eyes_Weather.git irish-weather
sudo chown -R $USER:$USER irish-weather
cd irish-weather
npm install --omit=dev
```

The repo is private, so git asks you to sign in. Use your GitHub username and
a personal access token as the password (GitHub > Settings > Developer
settings > Personal access tokens, "Contents: read" on this repo is enough).

## 4. Start it with pm2

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup                      # run the command it prints, once, so it survives reboots
curl -I http://127.0.0.1:3005    # should say 200 OK
```

Before this, run `sudo ss -tlnp | grep 3005`. No output means the port is
free. If it shows something, change 3005 as described above.

## 5. nginx

```bash
sudo cp deploy/nginx-weather.conf /etc/nginx/sites-available/weather.techx1.com
sudo ln -s /etc/nginx/sites-available/weather.techx1.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Visit http://weather.techx1.com and you should see the site (not yet HTTPS).

## 6. HTTPS

You probably already have certbot from the news site:

```bash
sudo certbot --nginx -d weather.techx1.com
```

Choose to redirect HTTP to HTTPS when asked. Renewal is automatic.
If certbot isn't installed: `sudo apt-get install -y certbot python3-certbot-nginx`.

## 7. Updating later

Whenever new code is pushed to GitHub, run on the server:

```bash
/var/www/irish-weather/deploy/update.sh
```

It pulls the latest code, installs anything new and restarts the site.

## Handy commands

- `pm2 status` shows whether it's running.
- `pm2 logs irish-weather` shows its log.
- `pm2 restart irish-weather` restarts it.

`render.yaml` in the repo is only for Render hosting and is ignored here.
