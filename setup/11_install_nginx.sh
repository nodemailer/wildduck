#! /bin/bash

OURNAME=11_install_nginx.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

#### NGINX ####

# Create initial certs. These will be overwritten later by Let's Encrypt certs
mkdir -p /etc/wildduck/certs
cd /etc/wildduck/certs
openssl req -subj "/CN=$HOSTNAME/O=My Company Name LTD./C=US" -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout privkey.pem -out fullchain.pem

chown -R wildduck:wildduck /etc/wildduck/certs
chmod 0700 /etc/wildduck/certs/privkey.pem

# create nginx config dirs - if missing
if [[ ! -d /etc/nginx/sites-available ]]; then
    mkdir -p /etc/nginx/sites-available
fi
if [[ ! -d /etc/nginx/sites-enabled ]]; then
    mkdir -p /etc/nginx/sites-enabled
fi

# Setup domain without SSL at first, otherwise acme.sh will fail
echo "server {
    listen 80;

    server_name $HOSTNAME;

    ssl_certificate /etc/wildduck/certs/fullchain.pem;
    ssl_certificate_key /etc/wildduck/certs/privkey.pem;

    # special config for EventSource to disable gzip
    location /api/events {
        proxy_http_version 1.1;
        gzip off;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header HOST \$http_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_pass http://127.0.0.1:3000;
        proxy_redirect off;
    }

    # special config for uploads
    location /webmail/send {
        client_max_body_size 15M;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header HOST \$http_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_pass http://127.0.0.1:3000;
        proxy_redirect off;
    }

    location / {
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header HOST \$http_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_pass http://127.0.0.1:3000;
        proxy_redirect off;
    }
}" > "/etc/nginx/sites-available/$HOSTNAME"
rm -rf "/etc/nginx/sites-enabled/$HOSTNAME"
ln -s "/etc/nginx/sites-available/$HOSTNAME" "/etc/nginx/sites-enabled/$HOSTNAME"
$SYSTEMCTL_PATH reload nginx
