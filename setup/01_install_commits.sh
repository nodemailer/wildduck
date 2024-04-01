#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="0ac0090deebdfca86024f954d2ef3ab4e22934ae"
ZONEMTA_COMMIT="6caff2cc4626606fced4d8fe5e21a306b904d30a" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="fb409a1303d71ac668e196729577f7f5d45ca9e8"
WILDDUCK_HARAKA_COMMIT="307206ed41ef9be9282a9b62087fa9f06ba64cda"
HARAKA_VERSION="3.0.3"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
