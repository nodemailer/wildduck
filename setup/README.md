# Wild Duck Installer

Here you can find an example install script to install Wild Duck with Haraka and ZoneMTA. The install script is self contained, you can upload to your server and start it. It fetches all required files from Github by itself.

## Usage

    sudo ./install.sh mydomain.com

Where mydomain.com is the domain name of your server.

If everything succeeds then open your browser http://mydomain.com/ and you should see the Wild Duck example webmail app. Create an account using that app and start receiving and sending emails! (Make sure though that your MX DNS uses mydomain.com)

The install script is tested on Ubuntu 16.04 and the server must be blank. There should be no existing software installed (eg. Apache or MySQL). If the server already has something installed, then remove the extra application before running this script.

Be aware though that the installation is not set up securely. MongoDB and Redis do not have authentication enabled. There are only self-signed certs installed (and Haraka on port 25 does not have any certs installed). The webmail app rins on HTTP which also means that Yubikey 2FA does not work.
