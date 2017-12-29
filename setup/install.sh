#!/bin/bash

# Run as root:
# sudo ./install.sh [maildomain.com]

INSTALLDIR=`pwd`

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

HOSTNAME="$1"

WILDDUCK_COMMIT="34a3243a4d6d9a67d39d872c08f3969bd548683e"
ZONEMTA_COMMIT="e058fccbf75a87c2d84df43e012ea579d2f9b481"
WEBMAIL_COMMIT="fc2b8d52c972caa439fc1d0f9e1da42f6ea650cc"
HARAKA_VERSION="2.8.14" # do not use 2.8.16
HARAKA_PLUGIN_WILDDUCK_VERSION="1.7.1"

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

# stop on first error
set -e

export DEBIAN_FRONTEND=noninteractive

function hook_script {
    echo "#!/bin/bash
git --git-dir=/var/opt/$1.git --work-tree=\"/opt/$1\" checkout "\$3" -f
cd \"/opt/$1\"
rm -rf package-lock.json
npm install --production --progress=false
sudo /bin/systemctl restart $1 || echo \"Failed restarting service\"" > "/var/opt/$1.git/hooks/update"
    chmod +x "/var/opt/$1.git/hooks/update"
}

# create user for running applications
useradd wildduck || echo "User wildduck already exists"

# create user for deploying code
useradd deploy || echo "User deploy already exists"

mkdir -p /home/deploy/.ssh
# add your own key to the authorized_keys file
echo "# Add your public key here
" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy

# mongo
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 0C49F3730359A14518585931BC711F9BA15703C6
gpg --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys 58712A2291FA4AD5
gpg --armor --export 58712A2291FA4AD5 | apt-key add -
echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.6 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list

apt-get update
apt-get -q -y install curl pwgen git ufw build-essential libssl-dev dnsutils python software-properties-common nginx lsb-release wget

# node
curl -sL https://deb.nodesource.com/setup_8.x | bash -

apt-get update

apt-get -q -y install mongodb-org nodejs

SRS_SECRET=`pwgen 12 -1`

systemctl enable mongod.service

# redis
apt-add-repository -y ppa:chris-lea/redis-server

# rspamd
CODENAME=`lsb_release -c -s`
wget -O- https://rspamd.com/apt-stable/gpg.key | apt-key add -
echo "deb http://rspamd.com/apt-stable/ $CODENAME main" > /etc/apt/sources.list.d/rspamd.list
echo "deb-src http://rspamd.com/apt-stable/ $CODENAME main" >> /etc/apt/sources.list.d/rspamd.list
apt-get update

apt-get -q -y install redis-server clamav clamav-daemon
apt-get -q -y --no-install-recommends install rspamd

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

# create update hook so we can later deploy to this location
hook_script wildduck

# allow deploy user to restart wildduck service
echo 'deploy ALL = (root) NOPASSWD: /bin/systemctl restart wildduck' >> /etc/sudoers.d/wildduck

# checkout files from git to working directory
mkdir /opt/wildduck
git --git-dir=/var/opt/wildduck.git --work-tree=/opt/wildduck checkout "$WILDDUCK_COMMIT"
cp -r /opt/wildduck/config /etc/wildduck
mv /etc/wildduck/default.toml /etc/wildduck/wildduck.toml

mv /opt/wildduck/emails/example.json.disabled /opt/wildduck/emails/example.json

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
npm install --unsafe-perm --production

chown -R deploy:deploy /var/opt/wildduck.git
chown -R deploy:deploy /opt/wildduck

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

cd /var/opt
git clone --bare git://github.com/nodemailer/haraka-plugin-wildduck.git
echo "#!/bin/bash
git --git-dir=/var/opt/haraka-plugin-wildduck.git --work-tree=/opt/haraka/plugins/wildduck checkout "\$3" -f
cd /opt/haraka/plugins/wildduck
rm -rf package-lock.json
npm install --production --progress=false
sudo /bin/systemctl restart haraka || echo \"Failed restarting service\"" > "/var/opt/haraka-plugin-wildduck.git/hooks/update"
chmod +x "/var/opt/haraka-plugin-wildduck.git/hooks/update"

# allow deploy user to restart wildduck service
echo 'deploy ALL = (root) NOPASSWD: /bin/systemctl restart haraka' >> /etc/sudoers.d/wildduck

cd
npm install --unsafe-perm -g Haraka@$HARAKA_VERSION
haraka -i /opt/haraka
cd /opt/haraka
npm install --unsafe-perm --save haraka-plugin-rspamd Haraka@$HARAKA_VERSION

# Haraka WIldDuck plugin. Install as separate repo as it can be edited more easily later
mkdir -p plugins/wildduck
git --git-dir=/var/opt/haraka-plugin-wildduck.git --work-tree=/opt/haraka/plugins/wildduck checkout "v$HARAKA_PLUGIN_WILDDUCK_VERSION"
cd plugins/wildduck
npm install --unsafe-perm --production --progress=false
cd /opt/haraka

mv config/plugins config/pluginbs.bak

echo "26214400" > config/databytes
echo "$HOSTNAME" > config/me
echo "WildDuck MX" > config/smtpgreeting

echo "spf

## ClamAV is disabled by default. Make sure freshclam has updated all
## virus definitions and clamav-daemon has successfully started before
## enabling it.
#clamd

rspamd
tls
#dkim_verify

# Wild Duck plugin handles recipient checking and queueing
wildduck" > config/plugins

echo "key=/etc/wildduck/certs/privkey.pem
cert=/etc/wildduck/certs/fullchain.pem" > config/tls.ini

echo 'host = localhost
port = 11333
add_headers = always
[dkim]
enabled = true
[header]
bar = X-Rspamd-Bar
report = X-Rspamd-Report
score = X-Rspamd-Score
spam = X-Rspamd-Spam
[check]
authenticated=true
private_ip=true
[reject]
spam = false
[soft_reject]
enabled = true
[rmilter_headers]
enabled = true
[spambar]
positive = +
negative = -
neutral = /' > config/rspamd.ini

echo 'clamd_socket = /var/run/clamav/clamd.ctl
[reject]
virus=true
error=false' > config/clamd.ini

cp plugins/wildduck/config/wildduck.yaml config/wildduck.yaml
sed -i -e "s/secret value/$SRS_SECRET/g" config/wildduck.yaml

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

chown -R deploy:deploy /opt/haraka
chown -R deploy:deploy /var/opt/haraka-plugin-wildduck.git

# ensure queue folder for Haraka
mkdir -p /opt/haraka/queue
chown -R wildduck:wildduck /opt/haraka/queue

systemctl enable haraka.service

#### ZoneMTA ####

cd /var/opt
git clone --bare git://github.com/zone-eu/zone-mta-template.git zone-mta.git

# create update hook so we can later deploy to this location
hook_script zone-mta

# allow deploy user to restart zone-mta service
echo 'deploy ALL = (root) NOPASSWD: /bin/systemctl restart zone-mta' >> /etc/sudoers.d/zone-mta

# checkout files from git to working directory
mkdir /opt/zone-mta
git --git-dir=/var/opt/zone-mta.git --work-tree=/opt/zone-mta checkout "$ZONEMTA_COMMIT"
cp -r /opt/zone-mta/config /etc/zone-mta
sed -i -e 's/port=2525/port=587/g;s/host="127.0.0.1"/host="0.0.0.0"/g;s/authentication=false/authentication=true/g' /etc/zone-mta/interfaces/feeder.toml
rm -rf /etc/zone-mta/plugins/dkim.toml
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
secret=\"$SRS_SECRET\"
# SRS domain, must resolve back to MX
rewriteDomain=\"$HOSTNAME\"

# Delivery settings for local messages
# do not set these values if you do not want to use local delivery

# Use LMTP instead of SMTP
localLmtp=false" > /etc/zone-mta/plugins/wildduck.toml

cd /opt/zone-mta/keys
openssl genrsa -out "$HOSTNAME-dkim.pem" 2048
chmod 400 "$HOSTNAME-dkim.pem"
openssl rsa -in "$HOSTNAME-dkim.pem" -out "$HOSTNAME-dkim.cert" -pubout
DNS_ADDRESS="v=DKIM1;p=$(grep -v -e '^-' $HOSTNAME-dkim.cert | tr -d "\n")"

DKIM_JSON=`DOMAIN="$HOSTNAME" node -e 'console.log(JSON.stringify({
  domain: process.env.DOMAIN,
  selector: "wildduck",
  description: "Default DKIM key for "+process.env.DOMAIN,
  privateKey: fs.readFileSync("/opt/zone-mta/keys/"+process.env.DOMAIN+"-dkim.pem", "UTF-8")
}))'`

cd /opt/zone-mta
npm install --unsafe-perm zonemta-wildduck --save
npm install --unsafe-perm --production

chown -R deploy:deploy /var/opt/zone-mta.git
chown -R deploy:deploy /opt/zone-mta

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

# create update hook so we can later deploy to this location
hook_script wildduck-webmail
chmod +x /var/opt/wildduck-webmail.git/hooks/update

# allow deploy user to restart zone-mta service
echo 'deploy ALL = (root) NOPASSWD: /bin/systemctl restart wildduck-webmail' >> /etc/sudoers.d/wildduck-webmail

# checkout files from git to working directory
mkdir /opt/wildduck-webmail
git --git-dir=/var/opt/wildduck-webmail.git --work-tree=/opt/wildduck-webmail checkout "$WEBMAIL_COMMIT"
cp /opt/wildduck-webmail/config/default.toml /etc/wildduck/wildduck-webmail.toml

sed -i -e "s/localhost/$HOSTNAME/g;s/999/99/g;s/2587/587/g" /etc/wildduck/wildduck-webmail.toml

cd /opt/wildduck-webmail
npm install --unsafe-perm --production

chown -R deploy:deploy /var/opt/wildduck-webmail.git
chown -R deploy:deploy /opt/wildduck-webmail

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
ufw allow 995/tcp
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

echo "DEPLOY SETUP

1. Add your ssh key to /home/deploy/.ssh/authorized_keys

2. Clone application code
\$ git clone deploy@$HOSTNAME:/var/opt/wildduck.git
\$ git clone deploy@$HOSTNAME:/var/opt/zone-mta.git
\$ git clone deploy@$HOSTNAME:/var/opt/wildduck-webmail.git
\$ git clone deploy@$HOSTNAME:/var/opt/haraka-plugin-wildduck.git

3. After making a change in local copy deploy to server
\$ git push origin master

NAMESERVER SETUP
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

echo "Waiting for the server to start up..."
sleep 15

# Ensure DKIM key
echo "Registering DKIM key for $HOSTNAME"
echo $DKIM_JSON

curl -i -XPOST http://localhost:8080/dkim \
-H 'Content-type: application/json' \
-d "$DKIM_JSON"

echo ""
cat "$INSTALLDIR/$HOSTNAME-nameserver.txt"
echo ""
echo "All done, open https://$HOSTNAME/ in your browser"
