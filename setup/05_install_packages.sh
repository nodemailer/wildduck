#! /bin/bash

OURNAME=05_install_packages.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

# install nginx
apt-get update
apt-get -q -y install pwgen git ufw build-essential libssl-dev dnsutils python software-properties-common nginx lsb-release wget

# install node 8
curl -sL https://deb.nodesource.com/setup_8.x | bash -

# install tor
apt-get update

apt-get -q -y install mongodb-org nodejs tor deb.torproject.org-keyring

# redis
apt-add-repository -y ppa:chris-lea/redis-server

# rspamd
apt-get -q -y install redis-server clamav clamav-daemon
apt-get -q -y --no-install-recommends install rspamd
apt-get clean
