#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="3d864c87debabe5494c6bfabb2d406949bb264a2"
ZONEMTA_COMMIT="bf3ca53d99b51808105dc63c3b263c1ca8b32c48" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="de3d8e5d5a206e467f4d555f3d37af517e632a99"
WILDDUCK_HARAKA_COMMIT="b46c91476295d309cfa1694d2cef629ea727a2ca"
HARAKA_VERSION="3.0.2"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
