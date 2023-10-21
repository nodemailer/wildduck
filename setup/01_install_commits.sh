#! /bin/bash

OURNAME=01_install_commits.sh

apt-get update
apt-get install -y lsb-release curl gnupg

NODEREPO="node_20.x"
MONGODB="7.0"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="38d80e49b2c4502aa7c873de6c2acdc2986835ce"
ZONEMTA_COMMIT="f6397a69e8d2f3b69bd4cfe7477c3086e8926762" # zone-mta-template
WEBMAIL_COMMIT="6e89e0e926798bfd04bc47f605df76129c067ac9"
WILDDUCK_ZONEMTA_COMMIT="4f46298b03ddf0120981b58e11357b88aaffb249"
WILDDUCK_HARAKA_COMMIT="7778d141cb1ca4e8cacfff7d7f50639d68feede5"
HARAKA_VERSION="3.0.2"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
