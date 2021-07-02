#! /bin/bash

OURNAME=12_install_ufw_rules.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

# get sshd port from /etc/ssh/sshd_config
_var_sshd_port="$(cat /etc/ssh/sshd_config|grep -i -E ^port|cut -f2 -d' ')"
if [[ $_var_sshd_port == "" ]]; then
    _var_sshd_port=22
fi

#### UFW ####
ufw allow $_var_sshd_port/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw allow 587/tcp
ufw allow 993/tcp
ufw allow 995/tcp
ufw --force enable
