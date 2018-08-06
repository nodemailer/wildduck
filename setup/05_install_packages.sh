#! /bin/bash

OURNAME=05_install_packages.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

# install nginx
apt-get update
apt-get -q -y install pwgen git ufw build-essential libssl-dev dnsutils python software-properties-common nginx wget

# install tor
apt-get update

apt-get -q -y install mongodb-org nodejs redis-server clamav clamav-daemon

# uncomment if you want to support tor
#apt-get -q -y install tor deb.torproject.org-keyring

# rspamd
apt-get -q -y --no-install-recommends install rspamd
apt-get clean
