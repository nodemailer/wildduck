#! /bin/bash

OURNAME=04_install_import_keys.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

# create user for running applications
useradd wildduck || echo "User wildduck already exists"

# remove old sudoers file
rm -rf /etc/sudoers.d/wildduck

# create user for deploying code
useradd deploy || echo "User deploy already exists"

mkdir -p /home/deploy/.ssh
# add your own key to the authorized_keys file
echo "# Add your public key here
" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy

export DEBIAN_FRONTEND=noninteractive
keyring="/usr/share/keyrings"

# nodejs
node_key_url="https://deb.nodesource.com/gpgkey/nodesource.gpg.key"
curl -s $node_key_url | gpg --dearmor | tee ${keyring}/nodesource.gpg >/dev/null

echo "deb https://deb.nodesource.com/$NODEREPO $CODENAME main" > /etc/apt/sources.list.d/nodesource.list
echo "deb-src https://deb.nodesource.com/$NODEREPO $CODENAME main" >> /etc/apt/sources.list.d/nodesource.list

# mongodb
mongo_key_url="https://pgp.mongodb.com/server-${MONGODB}.asc"
curl -s $mongo_key_url | gpg --dearmor | tee ${keyring}/mongodb-server-${MONGODB}.gpg >/dev/null
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/${MONGODB} multiverse" | tee /etc/apt/sources.list.d/mongodb-org-${MONGODB}.list

# rspamd
rspamd_key_url="https://rspamd.com/apt-stable/gpg.key"
curl -s $rspamd_key_url | gpg --dearmor | tee ${keyring}/rspamd.gpg >/dev/null

echo "deb http://rspamd.com/apt-stable/ $CODENAME main" > /etc/apt/sources.list.d/rspamd.list
echo "deb-src http://rspamd.com/apt-stable/ $CODENAME main" >> /etc/apt/sources.list.d/rspamd.list

# redis
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o ${keyring}/redis-archive-keyring.gpg
echo "deb [signed-by=${keyring}/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

apt-get update