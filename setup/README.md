# Wild Duck Installer

Here you can find an example install script to install Wild Duck with Haraka and ZoneMTA. The install script is self contained, you can upload to your server and start it as root. It fetches all required files from Github.

The install script is tested on Ubuntu 16.04 and the server must be blank. Blank meaning that there should be no existing software installed (eg. Apache, MySQL or Postfix). If the server already has something installed, then remove the extra applications before running this script. This also means that you should not run the install script in a VPS that you already use for other stuff.

## What does it do?

This install script installs and configures the following components:

1. **Wild Duck Mail Server** for IMAP and POP3
2. **Haraka** with Wild Duck plugin for incoming email
3. **ZoneMTA** with Wild Duck plugin for outbound email
4. **Wild Duck Webmail** for creating accounts and viewing messages
5. **Nginx** to serve the webmail component
6. **acme.sh** to manage Let's Encrypt certificates
7. **Rspamd** to check messages for spam. Messages detected as spam are routed to Junk Mail folder by default
8. **ClamAV** to check messages for viruses. ClamAV is disabled by default, you need to enable it in the Haraka plugins file
9. Unprivileged **Deploy** user to easily checkout and publish code changes via git

What it does not configure:

1. **DNS settings**. These you need to handle yourself. See domainname-nameserver.txt file after installation for DNS configuration (includes DKIM)

## Security

All components use TLS/HTTPS with Let's Encrypt certificates by default. Webmail component allows to set up two factor authentication (both TOTP and U2F). If 2FA is enabled then you can also generate application specific passwords for external applications (eg. for the IMAP client) from the Webmail interface as master password can not be used in that case.

## Usage

    $ wget https://raw.githubusercontent.com/nodemailer/wildduck/master/setup/install.sh
    $ chmod +x install.sh
    $ ./install.sh mydomain.com

Where mydomain.com is the domain name of your server.

Make sure that mydomain.com points to current server as the install script tries to fetch an SSL certificate from Let's Encrypt.

If the installation succeeds then the installer writes DNS configuration to domainname-nameserver.txt file. Set up the provided DNS entries from this file before sending and receiving email.

Next point your browser to https://mydomain.com/ and you should see the Wild Duck example webmail app where you can create an email account.

## Config files

Configuration files are installed to the following locations:

1. WildDuck: /etc/wildduck
2. ZoneMTA: /etc/zone-mta
3. WildDuck Webmail: /etc/wildduck/wildduck-webmail.toml
4. Haraka: /opt/haraka/config

## Code changes

Install script sets up applications as remote git repositories. You can clone these to your own machine using a special deploy user. If you push changes back to the remote repo, related services are restarted automatically.

```
$ git clone deploy@hostname:/var/opt/wildduck.git
$ cd wildduck
$ git checkout master
$ .... make some changes
$ git add .
$ git commit -m "made some changes"
$ git push origin master -f
```
