#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release curl gnupg

NODEREPO="node_20.x"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="cd3d52959e654af0e1cb56b612a2d4886f28e777"
ZONEMTA_COMMIT="0037bcd93c5147426c13a57794037f08840929ee" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="c9c50892f805f6871532a0f5329c0bcbb02e2c43"
WILDDUCK_HARAKA_COMMIT="ca3ac7626fc4f3db1587049bc4b1d1a1213cfd23"
HARAKA_VERSION="3.0.2"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
