#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="9a61cff18689f773b01a77d00d6e309507fb5dd8"
ZONEMTA_COMMIT="2ec1ba85a44c4665a6326271c8162ee76c4d6d02" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="f029b8d69aaa255b1c4f426848f994be21be8cd0"
WILDDUCK_HARAKA_COMMIT="a209775ceac579b8ac1a4c04c052674eba763691"
HARAKA_VERSION="3.0.3"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
