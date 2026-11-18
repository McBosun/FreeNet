# FreeNet backend

Sponsor-funded hotspot: API + Postgres + FreeRADIUS + MikroTik.

## Run
1. `cp env.example .env` and set real secrets. Put the same RADIUS secret in `radius/clients.conf` and `mikrotik.rsc`.
2. `docker compose --env-file .env up -d --build` (use a VPS with a public IP; open UDP 1812-1813 to the router only, TCP 3000 or put it behind HTTPS).
3. Put HTTPS in front of the API (Caddy or Nginx) at your portal domain. Paystack webhooks and sponsor logins need it.
4. Paystack dashboard: set webhook URL to `https://PORTAL_HOST/api/pay/webhook`.
5. Run `mikrotik.rsc` on the router and upload the redirect `login.html` it describes.

## How a login works
Phone sign-in, then ad, then claim. The API extends `access_until` and writes a one-time password plus `Session-Timeout` into `radcheck`/`radreply`.
The portal posts those to the MikroTik login URL, MikroTik asks FreeRADIUS, and the user is online until the timeout.

## Admin
`curl -H "x-admin-key: $ADMIN_KEY" https://PORTAL_HOST/api/admin/stats`
`curl -X POST -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" -d '{"minutes":60,"count":20}' https://PORTAL_HOST/api/admin/vouchers`
Admin page: `/admin.html`. First visit shows **Sign up**: create the super admin account using ADMIN_KEY as the one-time setup code. After that the page shows **Sign in**. Sponsor page: `/sponsor.html`.

## Before real users
- Test the FreeRADIUS container first with `radtest` (the SQL module config targets the 3.2 image; check `docker compose logs radius`).
- Add a real network uplink. Revenue only pays for it if sponsor cost per view covers the data each session uses.
- Host video ads on HTTPS and keep them short.
- Add rate limiting on `/api/login` and an admin UI if you want more than the API.
