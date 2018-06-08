#! /bin/bash

OURNAME=15_install_deploy.sh

echo -e "\n-- Executing ${ORANGE}${OURNAME}${NC} subscript --"

cd "$INSTALLDIR"

echo "DEPLOY SETUP

1. Add your ssh key to /home/deploy/.ssh/authorized_keys

2. Clone application code
\$ git clone deploy@$HOSTNAME:/var/opt/wildduck.git
\$ git clone deploy@$HOSTNAME:/var/opt/zone-mta.git
\$ git clone deploy@$HOSTNAME:/var/opt/wildduck-webmail.git
\$ git clone deploy@$HOSTNAME:/var/opt/haraka-plugin-wildduck.git
\$ git clone deploy@$HOSTNAME:/var/opt/zonemta-wildduck.git

3. After making a change in local copy deploy to server
\$ git push origin master
(you might need to use -f when pushing first time)

NAMESERVER SETUP
================

MX
--
Add this MX record to the $MAILDOMAIN DNS zone:

$MAILDOMAIN. IN MX 5 $HOSTNAME.

SPF
---
Add this TXT record to the $MAILDOMAIN DNS zone:

$MAILDOMAIN. IN TXT \"v=spf1 a:$HOSTNAME ~all\"

DKIM
----
Add this TXT record to the $MAILDOMAIN DNS zone:

$DKIM_SELECTOR._domainkey.$MAILDOMAIN. IN TXT \"$DNS_ADDRESS\"

PTR
---
Make sure that your public IP has a PTR record set to $HOSTNAME.
If your hosting provider does not allow you to set PTR records but has
assigned their own hostname, then edit /etc/zone-mta/pools.toml and replace
the hostname $HOSTNAME with the actual hostname of this server.

(this text is also stored to $INSTALLDIR/$MAILDOMAIN-nameserver.txt)" > "$INSTALLDIR/$MAILDOMAIN-nameserver.txt"

printf "Waiting for the server to start up.."

until $(curl --output /dev/null --silent --fail http://localhost:8080/users); do
    printf '.'
    sleep 2
done
echo "."

# Ensure DKIM key
echo "Registering DKIM key for $MAILDOMAIN"
echo $DKIM_JSON

curl -i -XPOST http://localhost:8080/dkim \
-H 'Content-type: application/json' \
-d "$DKIM_JSON"

echo ""
cat "$INSTALLDIR/$MAILDOMAIN-nameserver.txt"
echo ""
echo "All done, open https://$HOSTNAME/ in your browser"
