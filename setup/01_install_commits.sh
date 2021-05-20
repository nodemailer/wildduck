#! /bin/bash

OURNAME=01_install_commits.sh

NODEREPO="node_14.x"
MONGODB="4.2"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="5020adaf22cf379569bc1b064fadcb8d064b3ca8"
ZONEMTA_COMMIT="357ff6acdcf91c8a350c7b751560a06396c3e4ed" # zone-mta-template
WEBMAIL_COMMIT="38a25e73bec7c446ced92a76955a2799d1ce5ad3"
WILDDUCK_ZONEMTA_COMMIT="f6386f5b21660df3ecc42eb8c9cc1bd1f30e4e5c"
WILDDUCK_HARAKA_COMMIT="f6ac6da4afbcf1e827d29facccb64b6a0138f816"
HARAKA_VERSION="2.8.26"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
