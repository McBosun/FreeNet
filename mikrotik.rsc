# Paste into the MikroTik terminal. Replace SERVER_IP, PORTAL_HOST and the secret.
/radius add address=SERVER_IP secret=CHANGE_ME_LONG_RANDOM service=hotspot timeout=3s
/ip hotspot profile set [find default] use-radius=yes login-by=http-pap,mac-cookie
/ip hotspot walled-garden add dst-host=PORTAL_HOST comment=freenet-portal
/ip hotspot walled-garden ip add dst-address=SERVER_IP action=accept comment=freenet-api
# Then upload this as hotspot/login.html on the router so users are sent to the portal:
# <html><head><meta http-equiv="refresh" content="0;url=https://PORTAL_HOST/?login=$(link-login-only)&dst=$(link-orig-esc)"></head></html>
