#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="94434cab438cea0aa958d139e3ab8799db18a2b4"
ZONEMTA_COMMIT="bf3ca53d99b51808105dc63c3b263c1ca8b32c48" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="698aef09e5fce87689b49715ebdd5ea9cd0c8cb8"
WILDDUCK_HARAKA_COMMIT="c0837403a3483c9a8dd30a758015255fb2c3c9ad"
HARAKA_VERSION="3.0.2"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
