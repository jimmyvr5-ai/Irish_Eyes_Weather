# Hosting weather.techx1.com on your Hetzner server

This runs the site next to news.techx1.com on the same server: Node runs the
app on a private port (3005), pm2 keeps it running, and nginx passes
weather.techx1.com traffic to it with HTTPS from Let's Encrypt.

If your server uses Caddy or Docker instead of nginx, say so and the steps
change slightly. The commands below assume Ubuntu or Debian and nginx.

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

Port 3005 is used so it doesn't clash with the news site. If something else
already uses 3005 (`sudo ss -ltnp | grep 3005`), change the number in both
`deploy/ecosystem.config.js` and `deploy/nginx-weather.conf`.

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
