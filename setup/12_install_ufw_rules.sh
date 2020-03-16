#! /bin/bash

OURNAME=12_install_ufw_rules.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

#### UFW ####

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw allow 587/tcp
ufw allow 993/tcp
ufw allow 995/tcp
ufw --force enable
