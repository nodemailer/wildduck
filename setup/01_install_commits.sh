#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release ca-certificates curl gnupg

NODE_MAJOR="20"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="783ee16b732afb93cc4d58514e946b01720070bb"
ZONEMTA_COMMIT="0df73a3946eae0964a166b3015d3ed558d9d024f" # zone-mta-template
WEBMAIL_COMMIT="40ee1ef973de33de5bdf3e6b7e877d156d87436a"
WILDDUCK_ZONEMTA_COMMIT="1f4fad5ba771ce381ef0543e8c9c49ee25e4a6f2"
WILDDUCK_HARAKA_COMMIT="bf20a732f25a416d700522fdce8c31952c6950f7"
HARAKA_VERSION="3.0.5"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
