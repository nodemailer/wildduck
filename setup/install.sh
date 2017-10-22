#!/bin/bash

# Run as root:
# sudo ./install.sh [maildomain.com]

INSTALLDIR=`pwd`

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

HOSTNAME="$1"

WILDDUCK_COMMIT="86bad47bfe014eda0d0ff266c5feb3fe773e3e6e"
ZONEMTA_COMMIT="560094b82300e3aa550a0029e9b41ce61ea66367"
WEBMAIL_COMMIT="af3c7230dd786f95263681b9293f55f9a90f964f"

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

# stop on first error
set -e

export DEBIAN_FRONTEND=noninteractive

useradd wildduck

# mongo
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 0C49F3730359A14518585931BC711F9BA15703C6
echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.4.list

# node
curl -sL https://deb.nodesource.com/setup_8.x | bash -

apt-get update

apt-get -q -y install mongodb-org pwgen nodejs git ufw build-essential libssl-dev dnsutils python software-properties-common nginx

# redis
apt-add-repository -y ppa:chris-lea/redis-server
apt-get update
apt-get -q -y install redis-server

apt-get clean

if [ -z "$HOSTNAME" ]
  then
    PUBLIC_IP=`curl -s https://api.ipify.org`
    if [ ! -z "$PUBLIC_IP" ]; then
        HOSTNAME=`dig +short -x $PUBLIC_IP | sed 's/\.$//'`
        HOSTNAME="${HOSTNAME:-$PUBLIC_IP}"
    fi
    HOSTNAME="${HOSTNAME:-`hostname`}"
fi

node -v
redis-server -v
mongod --version
echo "HOSTNAME: $HOSTNAME"

####### WILD DUCK #######

cd /var/opt
git clone --bare git://github.com/nodemailer/wildduck.git
mkdir /opt/wildduck
git --git-dir=/var/opt/wildduck.git --work-tree=/opt/wildduck checkout "$WILDDUCK_COMMIT"
cp -r /opt/wildduck/config /etc/wildduck
mv /etc/wildduck/default.toml /etc/wildduck/wildduck.toml

sed -i -e "s/999/99/g;s/localhost/$HOSTNAME/g" /etc/wildduck/imap.toml
sed -i -e "s/999/99/g;s/localhost/$HOSTNAME/g" /etc/wildduck/pop3.toml

echo "enabled=true
port=24
disableSTARTTLS=true" > /etc/wildduck/lmtp.toml

echo "user=\"wildduck\"
group=\"wildduck\"
emailDomain=\"$HOSTNAME\"" | cat - /etc/wildduck/wildduck.toml > temp && mv temp /etc/wildduck/wildduck.toml

sed -i -e "s/localhost:3000/$HOSTNAME/g;s/localhost/$HOSTNAME/g;s/2587/587/g" /etc/wildduck/wildduck.toml

cd /opt/wildduck
sudo npm install --production

chown -R wildduck:wildduck /var/opt/wildduck.git
chown -R wildduck:wildduck /opt/wildduck

echo '[Unit]
Description=Wild Duck Mail Server
Conflicts=cyrus.service dovecot.service
After=mongod.service redis.service

[Service]
Environment="NODE_ENV=production"
WorkingDirectory=/opt/wildduck
ExecStart=/usr/bin/node server.js --config="/etc/wildduck/wildduck.toml"
ExecReload=/bin/kill -HUP $MAINPID
Type=simple
Restart=always

[Install]
WantedBy=multi-user.target' > /etc/systemd/system/wildduck.service

systemctl enable wildduck.service

####### HARAKA #######
cd
sudo npm install --unsafe-perm -g Haraka
haraka -i /opt/haraka
cd /opt/haraka
sudo npm install --save haraka-plugin-wildduck Haraka

mv config/plugins config/pluginbs.bak

echo "26214400" > config/databytes

echo "$HOSTNAME" > config/me

echo "spf
tls
queue/lmtp
wildduck" > config/plugins

echo "key=/etc/wildduck/certs/privkey.pem
cert=/etc/wildduck/certs/fullchain.pem" > config/tls.ini

echo "host=127.0.0.1
port=24" > config/lmtp.ini

echo '---
accounts:
  maxStorage: 1024
redis: "redis://127.0.0.1:6379/3"
mongo:
  url: "mongodb://127.0.0.1:27017/wildduck"
srs:
  secret: "supersecret"
attachments:
  type: "gridstore"
  bucket: "attachments"
  decodeBase64: true
log:
  authlogExpireDays: 30' > config/wildduck.yaml

echo '[Unit]
Description=Haraka MX Server
After=mongod.service redis.service

[Service]
Environment="NODE_ENV=production"
WorkingDirectory=/opt/haraka
ExecStart=/usr/bin/node ./node_modules/.bin/haraka -c .
Type=simple
Restart=always

[Install]
WantedBy=multi-user.target' > /etc/systemd/system/haraka.service

echo 'user=wildduck
group=wildduck' >> config/smtp.ini

chown -R wildduck:wildduck /opt/haraka

systemctl enable haraka.service

#### ZoneMTA ####

cd /var/opt
git clone --bare git://github.com/zone-eu/zone-mta-template.git zone-mta.git
mkdir /opt/zone-mta
git --git-dir=/var/opt/zone-mta.git --work-tree=/opt/zone-mta checkout "$ZONEMTA_COMMIT"
cp -r /opt/zone-mta/config /etc/zone-mta
sed -i -e 's/port=2525/port=587/g;s/host="127.0.0.1"/host="0.0.0.0"/g;s/authentication=false/authentication=true/g' /etc/zone-mta/interfaces/feeder.toml
echo '# @include "../wildduck/dbs.toml"' > /etc/zone-mta/dbs-production.toml
echo 'user="wildduck"
group="wildduck"' | cat - /etc/zone-mta/zonemta.toml > temp && mv temp /etc/zone-mta/zonemta.toml

echo "[[default]]
address=\"0.0.0.0\"
name=\"$HOSTNAME\"" > /etc/zone-mta/pools.toml

echo "[\"modules/zonemta-wildduck\"]
enabled=[\"receiver\", \"sender\"]

# which interfaces this plugin applies to
interfaces=[\"feeder\"]

# optional hostname to be used in headers
# defaults to os.hostname()
hostname=\"$HOSTNAME\"

# How long to keep auth records in log
authlogExpireDays=30

# SRS settings for forwarded emails

# Handle rewriting of forwarded emails
forwardedSRS=true
# SRS secret value. Must be the same as in the MX side
secret=\"secret value\"
# SRS domain, must resolve back to MX
rewriteDomain=\"$HOSTNAME\"

# Delivery settings for local messages
# do not set these values if you do not want to use local delivery

# Use LMTP instead of SMTP
localLmtp=true
localMxPort=24
# SMTP/LMTP server for local delivery
[[\"modules/zonemta-wildduck\".localMx]]
    priority=0
    # hostname is for logging only, IP is actually used
    exchange=\"$HOSTNAME\"
    A=[\"127.0.0.1\"]
    AAAA=[]
# Interface to be used for local delivery
# Make sure that it can connect to the localMX IP
[\"modules/zonemta-wildduck\".localZoneAddress]
    address=\"127.0.0.1\"
    name=\"$HOSTNAME\"" > /etc/zone-mta/plugins/wildduck.toml

sed -i -e "s/test/wildduck/g;s/example.com/$HOSTNAME/g;s/signTransportDomain=true/signTransportDomain=false/g;" /etc/zone-mta/plugins/dkim.toml
cd /opt/zone-mta/keys
openssl genrsa -out "$HOSTNAME-dkim.pem" 2048
chmod 400 "$HOSTNAME-dkim.pem"
openssl rsa -in "$HOSTNAME-dkim.pem" -out "$HOSTNAME-dkim.cert" -pubout
DNS_ADDRESS="v=DKIM1;p=$(grep -v -e '^-' $HOSTNAME-dkim.cert | tr -d "\n")"

cd /opt/zone-mta
sudo npm install zonemta-wildduck --save
sudo npm install --production

chown -R wildduck:wildduck /var/opt/zone-mta.git
chown -R wildduck:wildduck /opt/zone-mta

echo '[Unit]
Description=Zone Mail Transport Agent
Conflicts=sendmail.service exim.service postfix.service
After=mongod.service redis.service

[Service]
Environment="NODE_ENV=production"
WorkingDirectory=/opt/zone-mta
ExecStart=/usr/bin/node index.js --config="/etc/zone-mta/zonemta.toml"
ExecReload=/bin/kill -HUP $MAINPID
Type=simple
Restart=always

[Install]
WantedBy=multi-user.target' > /etc/systemd/system/zone-mta.service

systemctl enable zone-mta.service

#### WWW ####

cd /var/opt
git clone --bare git://github.com/nodemailer/wildduck-webmail.git
mkdir /opt/wildduck-webmail
git --git-dir=/var/opt/wildduck-webmail.git --work-tree=/opt/wildduck-webmail checkout "$WEBMAIL_COMMIT"
cp /opt/wildduck-webmail/config/default.toml /etc/wildduck/wildduck-webmail.toml

sed -i -e "s/localhost/$HOSTNAME/g;s/999/99/g;s/2587/587/g" /etc/wildduck/wildduck-webmail.toml

cd /opt/wildduck-webmail
sudo npm install --production

chown -R wildduck:wildduck /var/opt/wildduck-webmail.git
chown -R wildduck:wildduck /opt/wildduck-webmail

echo '[Unit]
Description=Wildduck Webmail
After=wildduck.service

[Service]
Environment="NODE_ENV=production"
WorkingDirectory=/opt/wildduck-webmail
ExecStart=/usr/bin/node server.js --config="/etc/wildduck/wildduck-webmail.toml"
ExecReload=/bin/kill -HUP $MAINPID
Type=simple
Restart=always

[Install]
WantedBy=multi-user.target' > /etc/systemd/system/wildduck-webmail.service

systemctl enable wildduck-webmail.service

#### NGINX ####

# Create initial certs. These will be overwritten later by Let's Encrypt certs
mkdir /etc/wildduck/certs
cd /etc/wildduck/certs
openssl req -subj "/CN=$HOSTNAME/O=My Company Name LTD./C=US" -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout privkey.pem -out fullchain.pem

chown -R wildduck:wildduck /etc/wildduck/certs
chmod 0700 /etc/wildduck/certs/privkey.pem

# Setup domain without SSL at first, otherwise acme.sh will fail
echo "server {
    listen 80;

    server_name $HOSTNAME;

    ssl_certificate /etc/wildduck/certs/fullchain.pem;
    ssl_certificate_key /etc/wildduck/certs/privkey.pem;

    location / {
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header HOST \$http_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_pass http://127.0.0.1:3000;
        proxy_redirect off;
    }
}" > "/etc/nginx/sites-available/$HOSTNAME"
ln -s "/etc/nginx/sites-available/$HOSTNAME" "/etc/nginx/sites-enabled/$HOSTNAME"
systemctl reload nginx

#### UFW ####

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw allow 587/tcp
ufw allow 993/tcp
ufw --force enable

#### SSL CERTS ####

curl https://get.acme.sh | sh

echo 'cert="/etc/wildduck/certs/fullchain.pem"
key="/etc/wildduck/certs/privkey.pem"' > /etc/wildduck/tls.toml

sed -i -e "s/key=/#key=/g;s/cert=/#cert=/g" /etc/zone-mta/interfaces/feeder.toml
echo '# @include "../../wildduck/tls.toml"' >> /etc/zone-mta/interfaces/feeder.toml

# vanity script as first run should not restart anything
echo '#!/bin/bash
echo "OK"' > /usr/local/bin/reload-services.sh
chmod +x /usr/local/bin/reload-services.sh

/root/.acme.sh/acme.sh --issue --nginx \
    -d "$HOSTNAME" \
    --key-file       /etc/wildduck/certs/privkey.pem  \
    --fullchain-file /etc/wildduck/certs/fullchain.pem \
    --reloadcmd     "/usr/local/bin/reload-services.sh" \
    --force || echo "Warning: Failed to generate certificates, using self-signed certs"

# Update site config, make sure ssl is enabled
echo "server {
    listen 80;
    server_name $HOSTNAME;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;

    server_name $HOSTNAME;

    ssl_certificate /etc/wildduck/certs/fullchain.pem;
    ssl_certificate_key /etc/wildduck/certs/privkey.pem;

    location / {
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header HOST \$http_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_pass http://127.0.0.1:3000;
        proxy_redirect off;
    }
}" > "/etc/nginx/sites-available/$HOSTNAME"
systemctl reload nginx

# update reload script for future updates
echo '#!/bin/bash
/bin/systemctl reload nginx
/bin/systemctl reload wildduck
/bin/systemctl restart zone-mta
/bin/systemctl restart haraka
/bin/systemctl restart wildduck-webmail' > /usr/local/bin/reload-services.sh
chmod +x /usr/local/bin/reload-services.sh

### start services ####

systemctl start mongod
systemctl start wildduck
systemctl start haraka
systemctl start zone-mta
systemctl start wildduck-webmail
systemctl reload nginx

cd "$INSTALLDIR"

echo "NAMESERVER SETUP
================

MX
--
Add this MX record to the $HOSTNAME DNS zone:

$HOSTNAME. IN MX 5 $HOSTNAME.

SPF
---
Add this TXT record to the $HOSTNAME DNS zone:

$HOSTNAME. IN TXT \"v=spf1 a ~all\"

DKIM
----
Add this TXT record to the $HOSTNAME DNS zone:

wildduck._domainkey.$HOSTNAME. IN TXT \"$DNS_ADDRESS\"

PTR
---
Make sure that your public IP has a PTR record set to $HOSTNAME.
If your hosting provider does not allow you to set PTR records but has
assigned their own hostname, then edit /etc/zone-mta/pools.toml and replace
the hostname $HOSTNAME with the actual hostname of this server.

(this text is also stored to $INSTALLDIR/$HOSTNAME-nameserver.txt)" > "$INSTALLDIR/$HOSTNAME-nameserver.txt"

echo ""
cat "$INSTALLDIR/$HOSTNAME-nameserver.txt"
echo ""
echo "All done, open https://$HOSTNAME/ in your browser"
