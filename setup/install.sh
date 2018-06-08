#! /bin/bash

# make sure the install script is started here
OURNAME=install.sh
INSTALLDIR=`pwd`
source "$INSTALLDIR/00_install_variables.sh"

args=("$@")
# echo $# arguments passed
# echo ${args[0]} ${args[1]} ${args[2]}

if [ "$#" -gt "0" ]
  then
    # foo/bar -> bar
    MAILDOMAIN=${args[0]}
    HOSTNAME=${args[1]:-$MAILDOMAIN}
    echo -e "DOMAINNAME: ${GREEN}$MAILDOMAIN${NC}, HOSTNAME: ${GREEN}$HOSTNAME${NC}"
  else
    echo -e "we got ${RED}ZERO${NC} arguments, so here is the manual:"
    fun_print_help
    exit
fi

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

# source is for executing in the current shell, and not in a subset.
# defined variables persists across files
declare -a arr=(
"01_install_commit_variables.sh"
"02_install_prerequisites.sh"
"03_install_check_running_services.sh"
"04_install_import_keys.sh"
"05_install_packages.sh"
"06_install_enable_services.sh"
"07_install_wildduck.sh"
"08_install_haraka.sh"
"09_install_zone_mta.sh"
"10_install_wildduck_webmail.sh"
"11_install_nginx.sh"
"12_install_ufw_rules.sh"
"13_install_ssl_certs.sh"
"14_install_start_services.sh"
"15_install_deploy.sh"
)

for i in "${arr[@]}"
do
  source "$INSTALLDIR/$i"
done
