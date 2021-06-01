#! /bin/bash

OURNAME=01_install_commits.sh

NODEREPO="node_14.x"
MONGODB="4.2"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="425652d4c004a3dfa124b9f69697c59bd92ccd92"
ZONEMTA_COMMIT="defb4b4c853075caee1f5a5894c7c2f823a364cd" # zone-mta-template
WEBMAIL_COMMIT="38a25e73bec7c446ced92a76955a2799d1ce5ad3"
WILDDUCK_ZONEMTA_COMMIT="f6386f5b21660df3ecc42eb8c9cc1bd1f30e4e5c"
WILDDUCK_HARAKA_COMMIT="f6ac6da4afbcf1e827d29facccb64b6a0138f816"
HARAKA_VERSION="2.8.26"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
