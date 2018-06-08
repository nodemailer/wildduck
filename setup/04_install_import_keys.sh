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

# mongo keys
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 0C49F3730359A14518585931BC711F9BA15703C6
gpg --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys 58712A2291FA4AD5
gpg --armor --export 58712A2291FA4AD5 | apt-key add -
echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.6 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list


# tor keys
# Setup tor to be able to send emails to .onion network.
# Receiving from onion is not automatically set up, you would have to
# create a hidden servcie first and then bridge port 25
echo 'deb http://deb.torproject.org/torproject.org xenial main
deb-src http://deb.torproject.org/torproject.org xenial main' > /etc/apt/sources.list.d/tor.list
gpg --keyserver keys.gnupg.net --recv A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89
gpg --export A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89 | sudo apt-key add -

# rspamd
CODENAME=`lsb_release -c -s`
wget -O- https://rspamd.com/apt-stable/gpg.key | apt-key add -
echo "deb http://rspamd.com/apt-stable/ $CODENAME main" > /etc/apt/sources.list.d/rspamd.list
echo "deb-src http://rspamd.com/apt-stable/ $CODENAME main" >> /etc/apt/sources.list.d/rspamd.list
apt-get update

apt-get -q -y install redis-server clamav clamav-daemon
apt-get -q -y --no-install-recommends install rspamd

apt-get clean
