#! /bin/bash

OURNAME=01_install_commits.sh

NODEREPO="node_14.x"
MONGODB="4.2"
CODENAME=`lsb_release -c -s`

WILDDUCK_COMMIT="0def6a1b97dd78ceaa5805e83ecad4415bbbdbf0"
ZONEMTA_COMMIT="339f8406bee64b7c67581e51e119d605ecc97700" # zone-mta-template
WEBMAIL_COMMIT="edd502485fe2a1bd9c9c685c306632ed097ebe5d"
WILDDUCK_ZONEMTA_COMMIT="33c5c766edf85ab32c18b5f9deba843b3381acdc"
WILDDUCK_HARAKA_COMMIT="0af35af16b3aaa1b25a243cf7f9d4ec8f6bc9aab"
HARAKA_VERSION="2.8.25"

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"
