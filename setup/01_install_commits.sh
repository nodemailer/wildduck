#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="af80959fdd51bc33f2c629cea765d36d56192d9f"
ZONEMTA_COMMIT="6caff2cc4626606fced4d8fe5e21a306b904d30a" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="8582afae2c75e519934148d9e3c18ef36e3bd2fa"
WILDDUCK_HARAKA_COMMIT="675eb169b3084c9ff0479adc0fd0548e8ddddd18"
HARAKA_VERSION="3.0.3"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
