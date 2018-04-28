# HTTP API

**DEPRECATED DOCS**, see https://api.wildduck.email

WildDuck Mail Server is a scalable IMAP / POP3 server that natively exposes internal data through an HTTP API.

This API is not meant to be used by end users but your application.

<!-- toc -->

*   [API Usage Info](#api-usage-info)
    *   [Authentication](#authentication)
    *   [Responses](#responses)
    *   [Paging](#paging)
*   [Users](#users)
    *   [Search and list users](#search-and-list-users)
        *   [GET /users](#get-users)
    *   [Get one user](#get-one-user)
        *   [GET /users/{user}](#get-usersuser)
    *   [Add a new user](#add-a-new-user)
        *   [POST /users](#post-users)
    *   [Update user details](#update-user-details)
        *   [PUT /users/{user}](#put-usersuser)
    *   [Delete user](#delete-user)
        *   [DELETE /users/{user}](#delete-usersuser)
    *   [Log out user from all IMAP sessions](#log-out-user-from-all-imap-sessions)
        *   [PUT /users/{user}/logout](#put-usersuserlogout)
    *   [Reset user password](#reset-user-password)
        *   [POST /users/{user}/password/reset](#post-usersuserpasswordreset)
*   [Authentication](#authentication-1)
    *   [Authenticate an user](#authenticate-an-user)
        *   [POST /authenticate](#post-authenticate)
    *   [List the authentication log](#list-the-authentication-log)
        *   [GET /users/{user}/authlog](#get-usersuserauthlog)
*   [2FA](#2fa)
    *   [Setup 2FA](#setup-2fa)
        *   [POST /users/{user}/2fa/totp/setup](#post-usersuser2fatotpsetup)
    *   [Verify 2FA](#verify-2fa)
        *   [POST /users/{user}/2fa/totp/enable](#post-usersuser2fatotpenable)
    *   [Check 2FA](#check-2fa)
        *   [POST /users/{user}/2fa/totp/check](#post-usersuser2fatotpcheck)
    *   [Disable TOTP](#disable-totp)
        *   [DELETE /users/{user}/2fa/totp](#delete-usersuser2fatotp)
    *   [Disable 2FA](#disable-2fa)
        *   [DELETE /users/{user}/2fa](#delete-usersuser2fa)
*   [Application Specific Passwords](#application-specific-passwords)
    *   [List existing passwords](#list-existing-passwords)
        *   [GET /user/{user}/asps](#get-useruserasps)
    *   [Add a new Application Specific Password](#add-a-new-application-specific-password)
        *   [POST /users/{user}/asps](#post-usersuserasps)
    *   [Delete an Application Specific Password](#delete-an-application-specific-password)
        *   [DELETE /users/{user}/asps/{asp}](#delete-usersuseraspsasp)
*   [Addresses](#addresses)
    *   [Search and list addresses](#search-and-list-addresses)
        *   [GET /addresses](#get-addresses)
    *   [List user addresses](#list-user-addresses)
        *   [GET /users/{user}/addresses](#get-usersuseraddresses)
    *   [Get one address](#get-one-address)
        *   [GET /users/{user}/addresses/{address}](#get-usersuseraddressesaddress)
    *   [Add a new address](#add-a-new-address)
        *   [POST /users/{user}/addresses](#post-usersuseraddresses)
    *   [Update address details](#update-address-details)
        *   [PUT /users/{user}/addresses/{address}](#put-usersuseraddressesaddress)
    *   [Delete an alias address](#delete-an-alias-address)
        *   [DELETE /users/{user}/addresses/{address}](#delete-usersuseraddressesaddress)
*   [Mailboxes](#mailboxes)
    *   [List existing mailboxes](#list-existing-mailboxes)
        *   [GET /user/{user}/mailboxes](#get-userusermailboxes)
    *   [Get one mailbox](#get-one-mailbox)
        *   [GET /users/{user}/mailboxes/{mailbox}](#get-usersusermailboxesmailbox)
    *   [Add a new mailbox](#add-a-new-mailbox)
        *   [POST /users/{user}/mailboxes](#post-usersusermailboxes)
    *   [Update mailbox details](#update-mailbox-details)
        *   [PUT /users/{user}/mailboxes/{mailbox}](#put-usersusermailboxesmailbox)
    *   [Delete a mailbox](#delete-a-mailbox)
        *   [DELETE /users/{user}/mailboxes/{mailbox}](#delete-usersusermailboxesmailbox)
*   [Messages](#messages)
    *   [List existing messages](#list-existing-messages)
        *   [GET /user/{user}/mailboxes/{mailbox}/messages](#get-userusermailboxesmailboxmessages)
    *   [List flagged messages](#list-flagged-messages)
        *   [GET /user/{user}/flagged](#get-useruserflagged)
    *   [Search for messages](#search-for-messages)
        *   [GET /user/{user}/search](#get-userusersearch)
    *   [Get message details](#get-message-details)
        *   [GET /users/{user}/mailboxes/{mailbox}/messages/{message}](#get-usersusermailboxesmailboxmessagesmessage)
    *   [Get message events](#get-message-events)
        *   [GET /users/{user}/mailboxes/{mailbox}/messages/{message}/events](#get-usersusermailboxesmailboxmessagesmessageevents)
    *   [Update message details](#update-message-details)
        *   [PUT /users/{user}/mailboxes/{mailbox}/messages/{message}](#put-usersusermailboxesmailboxmessagesmessage)
    *   [Delete a message](#delete-a-message)
        *   [DELETE /users/{user}/mailboxes/{mailbox}/messages/{message}](#delete-usersusermailboxesmailboxmessagesmessage)
    *   [Get message source](#get-message-source)
        *   [GET /users/{user}/mailboxes/{mailbox}/messages/{message}/message.eml](#get-usersusermailboxesmailboxmessagesmessagemessageeml)
    *   [Get message attachment](#get-message-attachment)
        *   [GET /users/{user}/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}](#get-usersusermailboxesmailboxmessagesmessageattachmentsattachment)
*   [Filters](#filters)
    *   [Create new filter](#create-new-filter)
        *   [POST /users/{user}/filters](#post-usersuserfilters)
    *   [List existing filters](#list-existing-filters)
        *   [GET /user/{user}/filters](#get-useruserfilters)
    *   [Get filter details](#get-filter-details)
        *   [GET /users/{user}/filters/{filter}](#get-usersuserfiltersfilter)
    *   [Update filter details](#update-filter-details)
        *   [PUT /users/{user}/filters/{filter}](#put-usersuserfiltersfilter)
    *   [Delete a filter](#delete-a-filter)
        *   [DELETE /users/{user}/filters/{filter}](#delete-usersuserfiltersfilter)
*   [Autoreplies](#autoreplies)
    *   [Setup Autoreply](#setup-autoreply)
        *   [PUT /users/{user}/autoreply](#put-usersuserautoreply)
    *   [Disable Autoreply](#disable-autoreply)
        *   [DELETE /users/{user}/autoreply](#delete-usersuserautoreply)
    *   [Check Autoreply status](#check-autoreply-status)
        *   [GET /users/{user}/autoreply](#get-usersuserautoreply)
*   [Archive](#archive)
    *   [List archived messages](#list-archived-messages)
        *   [GET /user/{user}/archived](#get-useruserarchived)
    *   [Get archived message details](#get-archived-message-details)
        *   [GET /users/{user}/archived/{message}](#get-usersuserarchivedmessage)
    *   [Restore archived message](#restore-archived-message)
        *   [POST /users/{user}/archived/{message}/restore](#post-usersuserarchivedmessagerestore)
*   [Quota](#quota)
    *   [Recalculate user quota](#recalculate-user-quota)
        *   [POST /users/{user}/quota/reset](#post-usersuserquotareset)
*   [Updates](#updates)
    *   [Stream update events](#stream-update-events)
        *   [GET /users/{user}/updates](#get-usersuserupdates)

<!-- tocstop -->

## API Usage Info

### Authentication

This API should be used by your application and not by the end users directly, so normally it should probably be hidden behind a firewall.

To add another layer of protection the API can be set to require an access token. The token value can be set in configuration file "api.accessToken". If the
value is set, then all requests against the API must include a query argument _accessToken_ with the same value as in the configuration file.

```
curl "http://localhost:8080/users?query=testuser01&accessToken=secrettoken"
```

### Responses

All successful responses look like the following:

```
{
  "success": true,
  other response specific fields
}
```

All failed responses look like the following:

```json
{
    "error": "Some error message"
}
```

### Paging

For paging lists longer than allowed limit, WildDuck API returns cursors for `next` and `previous` pages.

```json
{
    "success": true,
    "total": 200,
    "page": 2,
    "results": ["a list of results"],
    "previousCursor": "abcdef12344",
    "nextCursor": "abcdef12377"
}
```

The `page` property in return value is a "soft" argument, you need to set it yourself with the query argument. WildDuck does not know from which page the
request was made to but your application does. `limit` argument limits the output size (in most cases can not be set higher than 250).

Fetch next page using cursors:

    GET /users/{user}/mailboxes/{mailbox}/messages?next={nextCursor}&page={page+1}&limit=20

Fetch previous page using cursors:

    GET /users/{user}/mailboxes/{mailbox}/messages?previous={previousCursor}&page={page-1}&limit=20

## Users

User accounts

### Search and list users

#### GET /users

Returns data about existing users

**Parameters**

*   **query** is an optional string to filter username (partial match), by default all users are listed
*   **limit** is an optional number to limit listing length, defaults to 20
*   **tags** is an optional string of comma separated tags. At least a single tag must be set for an user to be listed
*   **requiredTags** is an optional string of comma separated tags. All tags must be set for an user to be listed

**Example**

```
curl "http://localhost:8080/users?query=testuser01&tags=red,green"
```

Response for a successful operation:

```json
{
    "success": true,
    "query": "testuser01",
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "results": [
        {
            "id": "59fc66a03e54454869460e45",
            "username": "testuser01@example.com",
            "name": null,
            "address": "testuser01@example.com",
            "tags": ["green", "blue"],
            "encryptMessages": false,
            "encryptForwarded": false,
            "quota": {
                "allowed": 107374182400,
                "used": 289838
            },
            "hasPasswordSet": true,
            "activated": true,
            "disabled": false
        }
    ]
}
```

### Get one user

#### GET /users/{user}

Returns data about a specific user

**Parameters**

*   **user** is the ID of the user

**Example**

```
curl "http://localhost:8080/users/59fc66a03e54454869460e45"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "59fc66a03e54454869460e45",
    "username": "testuser01",
    "name": null,
    "address": "testuser01@example.com",
    "retention": false,
    "enabled2fa": [],
    "encryptMessages": false,
    "encryptForwarded": false,
    "pubKey": "",
    "keyInfo": false,
    "limits": {
        "quota": {
            "allowed": 107374182400,
            "used": 289838
        },
        "recipients": {
            "allowed": 2000,
            "used": 0,
            "ttl": false
        },
        "forwards": {
            "allowed": 2000,
            "used": 0,
            "ttl": false
        }
    },
    "tags": ["green", "blue"],
    "hasPasswordSet": true,
    "activated": true,
    "disabled": false
}
```

Recipient/forward limits assume that messages are sent using ZoneMTA with [zonemta-wildduck](https://github.com/wildduck-email/zonemta-wildduck) plugin,
otherwise the counters are not updated or checked.

### Add a new user

#### POST /users

Creates a new user, returns the ID upon success.

**Parameters**

*   **username** (required) is the username of the user. This is not an email address but authentication username, use only letters and numbers
*   **password** (required) is the password for the user. You can use `false` to create an account without a password
*   **address** is the main email address for the user. If address is not set then a new one is generated based on the username and current domain name
*   **emptyAddress** if true, then do not set up an address for the user
*   **name** is the name for the user
*   **quota** is the maximum storage in bytes allowed for this user. If not set then the default value is used
*   **retention** is the default retention time in ms for mailboxes. Messages in Trash and Junk folders have a capped retention time of 30 days.
*   **language** is the language code for the user, eg. "en" or "et". Mailbox names for the default mailboxes (eg. "Trash") depend on the language
*   **recipients** is the maximum number of recipients allowed to send mail to in a 24h window. Requires ZoneMTA with the WildDuck plugin
*   **forwards** is the maximum number of forwarded emails in a 24h window. Requires ZoneMTA with the WildDuck plugin
*   **tags** is an array of tags to be associated with that user. Tags can be used for filtering.
*   **pubKey** is an optional PGP public key. WildDuck uses OpnePGP.js so keys using EC might not pass validation.
*   **encryptMessages** (boolean) indicates if messages stored should be encrypted using the PGP key
*   **encryptForwarded** (boolean) indicates if forwarded messages stored be encrypted using the PGP key. Encryption applies after filter rules
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Example**

```
curl -XPOST "http://localhost:8080/users" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "password": "secretpass",
  "address": "testuser@example.com",
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "59708695cdb513ce63340801"
}
```

After you have created an user you can use these credentials to log in to the IMAP server.

### Update user details

#### PUT /users/{user}

Updates the properties of an user. Only specify these fields that you want to be updated.

**Parameters**

*   **user** (required) is the ID of the user
*   **name** is the updated name for the user
*   **password** is the updated password for the user (do not set if you do not want to change user password)
*   **quota** is the maximum storage in bytes allowed for this user
*   **retention** is the default retention time in ms for mailboxes. Messages in Trash and Junk folders have a capped retention time of 30 days.
*   **language** is the language code for the user, eg. "en" or "et"
*   **recipients** is the maximum number of recipients allowed to send mail to in a 24h window. Requires ZoneMTA with the WildDuck plugin
*   **forwards** is the maximum number of forwarded emails in a 24h window. Requires ZoneMTA with the WildDuck plugin
*   **tags** is an array of tags to be associated with that user. Tags can be used for filtering.
*   **pubKey** is an optional PGP public key. WildDuck uses OpnePGP.js so keys using EC might not pass validation.
*   **encryptMessages** (boolean) indicates if messages stored should be encrypted using the PGP key
*   **encryptForwarded** (boolean) indicates if forwarded messages stored be encrypted using the PGP key. Encryption applies after filter rules
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

If you want the user to verify existing password before changing anything you can add the following POST field:

*   **existingPassword** is the current password provided by the user for extra verification

**Example**

Set user quota to 1 kilobyte:

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6" -H 'content-type: application/json' -d '{
  "quota": 1024
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Delete user

#### DELETE /users/{user}

Deletes user data form database. Messages are not immediately deleted but marked to be deleted in 2 days. Various related log entries expire by default
retention settings and are not touched by this call

**Parameters**

*   **user** is the ID of the user
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Example**

```
curl -XDELETE "http://localhost:8080/users/5970860fcdb513ce633407a1"
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Log out user from all IMAP sessions

#### PUT /users/{user}/logout

Forces closing all active IMAP session of an user

**Parameters**

*   **user** (required) is the ID of the user
*   **reason** is an optional message to be sent to the user with logout notification

**Example**

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6/logout" -H 'content-type: application/json' -d '{
  "reason": "Account was deleted"
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Reset user password

#### POST /users/{user}/password/reset

Generates a new temporary password and resets 2FA if set. Once user password is reset, then authentication results will include `requirePasswordChange: true`
parameter. This means that the user should not be able to perform regular actions before the password has been changed.

**Parameters**

*   **user** (required) is the ID of the user
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Example**

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/password/reset" -H 'content-type: application/json' -d '{}'
```

Response for a successful operation:

```json
{
    "success": true,
    "password": "somesecretvalue"
}
```

## Authentication

### Authenticate an user

#### POST /authenticate

Authenticates an user

**Parameters**

*   **username** (required) is the username or one of the email addresses of the user
*   **password** (required) is the password for the user. Can be either master password or an [application specific password](#application-specific-passwords)
*   **scope** is the scope to request for (defaults to "master"). Application specific password can not be used with "master" scope. Allowed scopes are "master",
    "imap", "pop3", "smtp"
*   **protocol** is the application type this authentication is made from, eg "IMAP" or "API". Only needed for logging
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`
*   **id** is the id of the authenticated user
*   **username** is the user name of the logged in user (useful if you logged in used)
*   **scope** is the scope this authentication is valid for
*   **require2fa** is an array of enabled 2FA mechanisms for this user. If the value is an empty array then 2FA is not enabled
*   **requirePasswordChange** if `true` then the user should be forced to change their password
*   **u2fAuthRequest** is set if U2F is enabled and 2FA is required. This value can be used to set up U2F check

**Example**

```
curl -XPOST "http://localhost:8080/authenticate" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "password": "amurboxphxvnyqre",
  "scope": "pop3",
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "5971da1754cfdc7f0983b2ec",
    "username": "testuser",
    "scope": "pop3",
    "require2fa": false,
    "requirePasswordChange": false
}
```

### List the authentication log

#### GET /users/{user}/authlog

Returns data about authentication related events. This includes also password changes, application specific password changes etc.

**Parameters**

*   **user** (required) is the ID of the user
*   **limit** is an optional number to limit listing length, defaults to 20
*   **action** is an optional filter to list only specific actions, for example "create asp" to list only entries for creating new application specific passwords
*   **sess** is an optional session identifier to be used for filtering
*   **ip** is an optional IP address to be used for filtering

**Example**

```
curl "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/authlog"
```

Response for a successful operation:

```json
{
    "success": true,
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": "sadasdsdfdfdfg",
    "results": [
        {
            "id": "59762d2f9c035be17bbb1fdf",
            "action": "create asp",
            "asp": "59762d2f9c035be17bbb1fde",
            "result": "success",
            "ip": "192.168.10.10",
            "created": "2017-07-24T17:23:59.041Z"
        }
    ]
}
```

Log entries expire after 30 days.

## 2FA

WildDuck supports TOTP and U2f based 2FA. If 2FA is enabled then users are requested to enter authentication token after successful login. Also, with 2FA
enabled, master password can not be used in IMAP, POP3 or SMTP. The user must create an [Application Specific Password](#application-specific-passwords) with a
correct scope for email clients using these protocols.

2FA checks do not happen magically, your application must be 2FA aware:

1.  Authenticate user with the [/authenticate](#authenticate-an-user) call
2.  If authentication result includes `requirePasswordChange:true` then force user to change their password
3.  If authentication result includes `require2fa:false` then do nothing, the user is now authenticated. Otherwise continue with Step 4. or Step 5.
4.  If `require2fa` array includes 'totp' then:
5.  Request TOTP token from the user before allowing to perform other actions
6.  Check the token with _/user/{user}/2fa/totp/check_
7.  If token verification succeeds then user is authenticated
8.  If `require2fa` array includes 'u2f' then:
9.  Authentication response should include u2fAuthRequest object. If it is missing or verification times out then you can fetch a new U2F request object from the
    server with _/user/{user}/2fa/u2f/start_
10. Send authentication request to U2F key
11. Send authentication response from key to server with _/user/{user}/2fa/totp/check_
12. If token verification succeeds then user is authenticated

### Setup 2FA

#### POST /users/{user}/2fa/totp/setup

This call prepares the user to support 2FA tokens. If 2FA is already enabled then this call fails.

**Parameters**

*   **user** (required) is the ID of the user
*   **issuer** is the name to be shown in the Authenticator App
*   **fresh** is a boolean. If true then generates a new seed even if an old one already exists
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`
*   **qrcode** is the data url for the 2FA QR-code. The user must scan the code and return the token with a PUT call

**Example**

```
curl -XPOST "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/2fa/totp/setup" -H 'content-type: application/json' -d '{
  "issuer": "testikas",
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "qrcode": "data:image/png;base64,iVBORw0KGgoAAAANSU..."
}
```

### Verify 2FA

#### POST /users/{user}/2fa/totp/enable

Once 2FA QR code is generated the user must return the token with this call. Once the token is successfully provided then 2FA is enabled for the account.

**Parameters**

*   **user** (required) is the ID of the user
*   **token** is the 2FA token generated from the QR code
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`

**Example**

```
curl -XPOST "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/2fa/totp/enable" -H 'content-type: application/json' -d '{
  "token": "455912",
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Check 2FA

#### POST /users/{user}/2fa/totp/check

Validates a TOTP token against user 2FA settings. This check should be performed when an user authentication response includes `request2fa:['totp']`

**Parameters**

*   **user** (required) is the ID of the user
*   **token** (required) is the token to check
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`

**Example**

```
curl -XPOST "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/2fa/totp/check" -H 'content-type: application/json' -d '{
  "token": "455912",
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Disable TOTP

#### DELETE /users/{user}/2fa/totp

Disabling TOTP for authentication. Other 2FA schemes remain in place.

**Parameters**

*   **user** (required) is the ID of the user
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`

**Example**

```
curl -XDELETE "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/2fa/totp?ip=192.168.10.10"
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Disable 2FA

#### DELETE /users/{user}/2fa

Disables all 2FA schemes. Disabling 2FA re-enables master password usage for IMAP, POP3 and SMTP.

**Parameters**

*   **user** (required) is the ID of the user
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Response fields**

*   **success** should be `true`

**Example**

```
curl -XDELETE "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/2fa?ip=192.168.10.10"
```

Response for a successful operation:

```json
{
    "success": true
}
```

## Application Specific Passwords

Application Specific Passwords can be used to allow specific applications to access only specific parts of the user account. For example one password can be
used to access IMAP, one for SMTP etc.

### List existing passwords

#### GET /user/{user}/asps

Lists all application specific passwords for an user.

**Parameters**

*   **user** (required) is the ID of the user

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/asps"
```

Response for a successful operation:

```json
{
    "success": true,
    "results": [
        {
            "id": "5975d1ac97130ca55afa0c7f",
            "description": "OSX Mail App",
            "scopes": ["*"],
            "created": "2017-07-24T10:53:32.136Z"
        },
        {
            "id": "5975f5e5453019c6ebfed3b4",
            "description": "Nodemailer",
            "scopes": ["smtp"],
            "created": "2017-07-24T13:28:05.770Z"
        }
    ]
}
```

### Add a new Application Specific Password

#### POST /users/{user}/asps

Creates a new Application Specific Password for an existing user, returns the ID upon success.

**Parameters**

*   **user** (required) is the ID of the user
*   **description** (required) is the name or description for the new Application Specific Password
*   **scopes** is an array (or a comma separated string) of scopes this password is valid for. Valid scopes are "imap", "pop3", "smtp". Special scope "\*" (also
    the default) is valid for all ASP supported scopes (this does not include "master")
*   **generateMobileconfig** is a boolean. If true, then the result includes a base64 formatted profile file to autoconfigure OSX and iOS mail clients
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Example**

```
curl -XPOST "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/asps" -H 'content-type: application/json' -d '{
  "description": "Mac OSX Mail Client",
  "scopes": ["*"],
  "ip": "192.168.10.10"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "59762d2f9c035be17bbb1fde",
    "password": "mjxlzydlusadfynn"
}
```

Or with the profile file:

```
curl -XPOST "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/asps" -H 'content-type: application/json' -d '{
    "description": "Mac OSX Mail Client",
    "scopes": ["imap", "smtp"],
    "generateMobileconfig": true
    "ip": "192.168.10.10"
}'
```

and the result with the profile file:

```json
{
    "success": true,
    "id": "59773be3a7bc855155286d91",
    "password": "slrfwaavyzmatgxf",
    "mobileconfig": "MIIO8gYJKoZIhvcNAQcCo..."
}
```

Resulting password should be shown to the client. This password is shown only once so if the user forgets it then the APS should be deleted and replaced with a
new one. Application Specific Password can include spaces, so using "slrf waav yzma tgxf" is the same as "slrfwaavyzmatgxf".

Profile file should be sent to the client with Content-Type value of `application/x-apple-aspen-config`.

```javascript
res.set('Content-Description', 'Mail App Configuration Profile');
res.set('Content-Type', 'application/x-apple-aspen-config');
res.set('Content-Disposition', 'attachment; filename="profile.mobileconfig"');
res.send(Buffer.from(asp.mobileconfig, 'base64'));
```

### Delete an Application Specific Password

#### DELETE /users/{user}/asps/{asp}

Deletes an Application Specific Password

**Parameters**

*   **user** (required) is the ID of the user
*   **asp** (required) is the ID of the Application Specific Password
*   **sess** an optional string of user session to be stored in security log
*   **ip** is the IP address the request was made from

**Example**

```
curl -XDELETE "http://localhost:8080/users/59467f27535f8f0f067ba8e6/asps/59762d2f9c035be17bbb1fde?ip=192.168.10.10"
```

Response for a successful operation:

```json
{
    "success": true
}
```

## Addresses

Manage email addresses

### Search and list addresses

#### GET /addresses

Returns data about existing addresses. Use this endpoint if you want to find an address but do not know to which user it belongs to.

**Parameters**

*   **query** is an optional string to filter addresses (partial match), by default all addresses are listed
*   **limit** is an optional number to limit listing length, defaults to 20

**Example**

```
curl "http://localhost:8080/addresses?query=testuser01"
```

Response for a successful operation:

```json
{
    "success": true,
    "query": "testuser01",
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "results": [
        {
            "id": "5970860fcdb513ce633407a8",
            "address": "testuser01@example.com",
            "user": "5970860fcdb513ce633407a1"
        }
    ]
}
```

### List user addresses

#### GET /users/{user}/addresses

Lists all registered email addresses for an user.

**Parameters**

*   **user** (required) is the ID of the user

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/addresses"
```

Response for a successful operation:

```json
{
    "success": true,
    "results": [
        {
            "id": "596c9c37ef2213165daadc6b",
            "address": "testuser@example.com",
            "main": true,
            "created": "2017-07-17T11:15:03.841Z"
        },
        {
            "id": "596c9dd31b201716e764efc2",
            "address": "user@example.com",
            "main": false,
            "created": "2017-07-17T11:21:55.960Z"
        }
    ]
}
```

### Get one address

#### GET /users/{user}/addresses/{address}

Returns data about a specific address.

**Parameters**

*   **user** (required) is the ID of the user
*   **address** (required) is the ID of the address

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/addresses/596c9c37ef2213165daadc6b"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "596c9c37ef2213165daadc6b",
    "address": "testuser@example.com",
    "main": true,
    "created": "2017-07-17T11:15:03.841Z"
}
```

### Add a new address

#### POST /users/{user}/addresses

Creates a new email address alias for an existing user, returns the ID upon success.

**Parameters**

*   **user** (required) is the ID of the user
*   **address** (required) is the email address to use as an alias for this user. You can also use internationalized email addresses like _андрис@уайлддак.орг_.
*   **main** indicates that this is the default address for that user (defaults to _false_)

**Example**

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/addresses" -H 'content-type: application/json' -d '{
  "address": "user@example.com"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "596c9dd31b201716e764efc2"
}
```

After you have registered a new address then LMTP maildrop server starts accepting mail for it and stores messages to the users mailbox.

### Update address details

#### PUT /users/{user}/addresses/{address}

Updates the properties of an address. Currently, only `main` can be updated.

**Parameters**

*   **user** (required) is the ID of the user
*   **address** (required) is the ID of the address
*   **main** must be true. Indicates that this is the default address for that user

**Example**

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6/addresses/596c9dd31b201716e764efc2" -H 'content-type: application/json' -d '{
  "main": true
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Delete an alias address

#### DELETE /users/{user}/addresses/{address}

Deletes an email address alias from an existing user.

**Parameters**

*   **user** (required) is the ID of the user
*   **address** (required) is the ID of the address

**Example**

```
curl -XDELETE "http://localhost:8080/users/59467f27535f8f0f067ba8e6/addresses/596c9dd31b201716e764efc2"
```

Response for a successful operation:

```json
{
    "success": true
}
```

## Mailboxes

Manage user mailboxes

### List existing mailboxes

#### GET /user/{user}/mailboxes

Lists existing mailboxes for an user

**Parameters**

*   **user** (required) is the ID of the user
*   **counters** is an optional GET argument to include counters (total messages, unseen messages) in listing results. Not recommended if you have a large list as
    checking every counter can be expensive operation.

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes"
```

Response for a successful operation:

```json
{
    "success": true,
    "results": [
        {
            "id": "597089f1b3378cd394611284",
            "name": "INBOX",
            "path": "INBOX",
            "specialUse": null,
            "modifyIndex": 71,
            "subscribed": true
        },
        {
            "id": "597089f1b3378cd394611289",
            "name": "Archive",
            "path": "Archive",
            "specialUse": "\\Archive",
            "modifyIndex": 0,
            "subscribed": true
        },
        {
            "id": "597089f1b3378cd394611287",
            "name": "Drafts",
            "path": "Drafts",
            "specialUse": "\\Drafts",
            "modifyIndex": 0,
            "subscribed": true
        }
    ]
}
```

List mailboxes with counters

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes?counters=true"
```

Response for a successful operation:

```json
{
    "success": true,
    "mailboxes": [
        {
            "id": "597089f1b3378cd394611284",
            "name": "INBOX",
            "path": "INBOX",
            "specialUse": null,
            "modifyIndex": 71,
            "subscribed": true,
            "total": 33,
            "unseen": 8
        },
        {
            "id": "597089f1b3378cd394611289",
            "name": "Archive",
            "path": "Archive",
            "specialUse": "\\Archive",
            "modifyIndex": 0,
            "subscribed": true,
            "total": 0,
            "unseen": 0
        },
        {
            "id": "597089f1b3378cd394611287",
            "name": "Drafts",
            "path": "Drafts",
            "specialUse": "\\Drafts",
            "modifyIndex": 0,
            "subscribed": true,
            "total": 0,
            "unseen": 0
        }
    ]
}
```

### Get one mailbox

#### GET /users/{user}/mailboxes/{mailbox}

Returns data about a specific address.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/597089f1b3378cd394611284"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "597089f1b3378cd394611284",
    "name": "INBOX",
    "path": "INBOX",
    "specialUse": null,
    "modifyIndex": 71,
    "subscribed": true,
    "total": 33,
    "unseen": 8
}
```

### Add a new mailbox

#### POST /users/{user}/mailboxes

Creates a new mailbox for an existing user account, returns the ID upon success.

**Parameters**

*   **user** (required) is the ID of the user
*   **path** (required) is the mailbox path with slashes as folder separators. Parent folder does not have to exist. Using unicode characters is allowed.
*   **retention** optional retention time in milliseconds that applies to messages in that mailbox

**Example**

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes" -H 'content-type: application/json' -d '{
  "path": "My New mailbox"
}'
```

or as a subfolder

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes" -H 'content-type: application/json' -d '{
  "path": "Some parent/Subfolder/My New mailbox"
}'
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "596c9dd31b201716e764efc2"
}
```

### Update mailbox details

#### PUT /users/{user}/mailboxes/{mailbox}

Updates the properties of a mailbox.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **path** is the optional new mailbox path if you want to rename the mailbox. INBOX can not be renamed.
*   **retention** is the optional new retention time. Changing retention time applies only to new messages. Existing messages expire once the original retention
    time is reached

**Example**

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2" -H 'content-type: application/json' -d '{
  "path": "New Mailbox Name"
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Delete a mailbox

#### DELETE /users/{user}/mailboxes/{mailbox}

Deletes a mailbox. Only user made mailboxes can be deleted. Special mailboxes (INBOX, Trash etc) can not be deleted.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox

**Example**

```
curl -XDELETE "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2"
```

Response for a successful operation:

```json
{
    "success": true
}
```

## Messages

Manage messages in a mailbox. While other data types usually have a 24 byte hex string ID value then message object have integers as IDs. These values map to
IMAP UID values.

### List existing messages

#### GET /user/{user}/mailboxes/{mailbox}/messages

Lists existing messages in a mailbox

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **order** optional message ordering, either "asc" or "desc". Defaults to "desc" (newer first)

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2/messages"
```

Response for a successful operation:

```json
{
    "success": true,
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "specialUse": null,
    "results": [
        {
            "id": 444,
            "mailbox": "59467f27535f8f0f067ba8e6",
            "thread": "5971da7754cfdc7f0983bbde",
            "from": {
                "address": "sender@example.com",
                "name": "Sender Name"
            },
            "subject": "Subject line",
            "date": "2011-11-02T19:19:08.000Z",
            "intro": "Beginning text in the message…",
            "attachments": false,
            "seen": true,
            "deleted": false,
            "flagged": false,
            "draft": false
        }
    ]
}
```

### List flagged messages

#### GET /user/{user}/flagged

Lists flagged messages in the account (excludes Spam and Trash)

**Parameters**

*   **user** (required) is the ID of the user
*   **order** optional message ordering, either "asc" or "desc". Defaults to "desc" (newer first)

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/flagged"
```

Response for a successful operation:

```json
{
    "success": true,
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "results": [
        {
            "id": 444,
            "mailbox": "59467f27535f8f0f067ba8e6",
            "thread": "5971da7754cfdc7f0983bbde",
            "from": {
                "address": "sender@example.com",
                "name": "Sender Name"
            },
            "subject": "Subject line",
            "date": "2011-11-02T19:19:08.000Z",
            "intro": "Beginning text in the message…",
            "attachments": false,
            "seen": true,
            "deleted": false,
            "flagged": true,
            "draft": false
        }
    ]
}
```

### Search for messages

#### GET /user/{user}/search

Search user messages. This is a account wide search function that searches from every folder except Trash and Junk.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **query** query string to search for

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/search?query=myname"
```

Response for a successful operation:

```json
{
    "success": true,
    "query": "myname",
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "results": [
        {
            "id": 444,
            "mailbox": "59467f27535f8f0f067ba8e6",
            "thread": "5971da7754cfdc7f0983bbde",
            "from": {
                "address": "sender@example.com",
                "name": "Sender Name"
            },
            "subject": "Subject line",
            "date": "2011-11-02T19:19:08.000Z",
            "intro": "Beginning text in the message…",
            "attachments": false,
            "seen": true,
            "deleted": false,
            "flagged": false,
            "draft": false
        }
    ]
}
```

The search uses MongoDB fulltext index, see [MongoDB docs](https://docs.mongodb.com/manual/reference/operator/query/text/#search-field) for explanation how to
use it.

### Get message details

#### GET /users/{user}/mailboxes/{mailbox}/messages/{message}

Returns data about a specific message.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2/messages/444"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": 444,
    "from": {
        "address": "sender@example.com",
        "name": "Sender Name"
    },
    "to": [
        {
            "address": "testuser@example.com",
            "name": "Test User"
        }
    ],
    "subject": "Subject line",
    "messageId": "<FA472D2A-092E-44BC-9D38-AFACE48AB98E@example.com>",
    "date": "2011-11-02T19:19:08.000Z",
    "seen": true,
    "deleted": false,
    "flagged": false,
    "draft": false,
    "html": ["Notice that the HTML content is an array of HTML strings"],
    "attachments": []
}
```

### Get message events

#### GET /users/{user}/mailboxes/{mailbox}/messages/{message}/events

Returns timeline information about a specific message.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message

**Example**

```
curl "http://localhost:8080/users/59cb9b0f8d78173c5fc6871c/mailboxes/59cb9b0f8d78173c5fc6871d/messages/43/events"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "59e9dfac7f60c84cb2c467c4",
    "events": [
        {
            "id": "15f3991b258000f6e5.002",
            "action": "STORE",
            "source": "MX",
            "origin": "sender.com",
            "from": "andris12@example.com",
            "to": ["andris2@example.com"],
            "transtype": "ESMTPSA",
            "time": "2017-10-20T11:36:12.481Z"
        },
        {
            "id": "15f3991b9d7000fb8f",
            "action": "FORWARD",
            "from": "andris12@example.com",
            "to": ["andris@kreata.ee", "andris.reinman@gmail.com"],
            "time": "2017-10-20T11:36:12.523Z"
        },
        {
            "id": "15f3991b9d7000fb8f",
            "seq": "002",
            "action": "REJECTED",
            "src": "0.0.0.0",
            "dst": "gmail-smtp-in.l.google.com",
            "response":
                "421-4.7.0 This message does not have authentication information or fails to pass authentication checks. To best protect our users from spam, the message has been blocked. Please visit https://",
            "from": "andris12@example.com",
            "to": ["andris.reinman@gmail.com"],
            "time": "2017-10-20T11:36:18.446Z"
        },
        {
            "id": "15f3991b9d7000fb8f",
            "seq": "001",
            "action": "ACCEPTED",
            "src": "0.0.0.0",
            "dst": "aspmx.l.google.com",
            "response": "250 2.0.0 OK 1508499378 v89si365958lje.238 - gsmtp",
            "from": "andris12@example.com",
            "to": ["andris@kreata.ee"],
            "time": "2017-10-20T11:36:18.934Z"
        }
    ]
}
```

### Update message details

#### PUT /users/{user}/mailboxes/{mailbox}/messages/{message}

Updates the properties of a message or move the message to another mailbox. This call can be used to modify more than a single message at once (see the "messge"
parameter description).

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message (eg. "messages/444") or a comma separated list of IDs (eg. "messages/444,445,446") or a range of message IDs
    (eg. "messages/444:446")
*   **moveTo** is the ID of the destination mailbox if you want to move the message
*   **seen** is a boolean to mark message as seen or unseen
*   **flagged** is a boolean to mark message as flagged or not
*   **draft** is a boolean to mark message as a draft or not
*   **deleted** is a boolean to mark message as deleted or not. This value is used by IMAP clients to indicate that a message should be deleted in the future
*   **expires** is either a date/timestamp to autodelete the message at given time or `false` if you want to clear the expiration date. Message is not deleted
    exactly on the expire time, it is only marked to be deleted and it is removed after the garbage collector process steps in.

**Example**

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2/messages/444" -H 'content-type: application/json' -d '{
  "seen": true
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Delete a message

#### DELETE /users/{user}/mailboxes/{mailbox}/messages/{message}

Deletes a message from mailbox. This deletes the message entirely, in most cases consider the message to the Trash folder instead.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message

**Example**

```
curl -XDELETE "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/mailboxes/5971da1754cfdc7f0983b2ed/messages/444"
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Get message source

#### GET /users/{user}/mailboxes/{mailbox}/messages/{message}/message.eml

Returns raw message source.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2/messages/444/message.eml"
```

Response for a successful operation:

```
HTTP/1.1 200 OK
Server: WildDuck API
Content-Type: message/rfc822
Date: Fri, 21 Jul 2017 19:11:04 GMT
Connection: keep-alive
Transfer-Encoding: chunked

Delivered-To: testuser@example.com
Received: .....
<rfc822 formatted message>
```

### Get message attachment

#### GET /users/{user}/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}

Returns data about a specific address.

**Parameters**

*   **user** (required) is the ID of the user
*   **mailbox** (required) is the ID of the mailbox
*   **message** (required) is the ID of the message
*   **attachment** (required) is the ID of the attachment

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/mailboxes/596c9dd31b201716e764efc2/messages/444/attachments/ATT00001"
```

Response for a successful operation:

```
HTTP/1.1 200 OK
Server: WildDuck API
Content-Type: image/png
Date: Fri, 21 Jul 2017 18:39:05 GMT
Connection: keep-alive
Transfer-Encoding: chunked

<attachment contents>
```

## Filters

Manage message filters. Filters are applied to incoming messages in LMTP and these can be used to move specific messages to specific mailboxes, mark messages as
seen etc.

### Create new filter

#### POST /users/{user}/filters

Creates a filter

**Parameters**

*   **user** (required) is the ID of the user
*   **filter** (required) is the ID of the filter to update
*   **name** is the name of the filter
*   **query_from** is a string to match against the From: header
*   **query_to** is a string to match against the To:/Cs: headers
*   **query_subject** is a string to match against the Subject: header
*   **query_text** is a string to match against the message text
*   **query_ha** is a boolean that requires the message to have attachments (true) or not attachments (false)
*   **query_size** is a number that requires the RFC822 message size be larger than (positive integer) or smaller than (negative integer)
*   **action_seen** is a boolean that marks message as seen (true) or unseen (false)
*   **action_flag** is a boolean that marks message as flagged (true) or not (false)
*   **action_delete** is a boolean that makes the message to be deleted immediately (true). This action does not initiate a bounce, the message is dropeed
    silently
*   **action_spam** is a boolean that marks message as spam (true) or not spam (false). Spam messages are automatically moved to the Junk mailbox
*   **action_mailbox** is the mailbox ID the message should me moved to
*   **action_forward** is an email address the message should be forwarded to. You can also mix this action with `delete`.
*   **action_targetUrl** is a web URL the message should be uploaded to

If a key is not included or is empty in update payload then the key is not used for when filtering.

**Example**

This example sets up a filter to search for "abc" in From: header, matching messages are flagged.

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/filters" -H 'content-type: application/json' -d '{
  "query_from": "abc",
  "action_flag": true
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### List existing filters

#### GET /user/{user}/filters

Lists existing messages in a mailbox

**Parameters**

*   **user** (required) is the ID of the user

The listing entries include query and action arrays. These are meant to be human readable descriptions divided into tuples. This would allow using translation
on the left side elements (keys). In the end these values should be joined together into a description string.

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/filters"
```

Response for a successful operation:

```json
{
    "success": true,
    "results": [
        {
            "id": "59759c440e1d676f15e76b5f",
            "name": "Flag messages from abc",
            "query": [["from", "(abc)"]],
            "action": [["flag it"]],
            "created": "2017-07-24T07:05:40.355Z"
        }
    ]
}
```

### Get filter details

#### GET /users/{user}/filters/{filter}

Returns data about a specific filter.

**Parameters**

*   **user** (required) is the ID of the user
*   **filter** (required) is the ID of the filter

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/filters/59759c440e1d676f15e76b5f"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "59759c440e1d676f15e76b5f",
    "name": "Flag messages from abc",
    "created": "2017-07-24T07:05:40.355Z",
    "query_from": "abc",
    "action_flag": true
}
```

### Update filter details

#### PUT /users/{user}/filters/{filter}

Updates the properties of a filter. To unset a specific key use an empty string as the value.

**Parameters**

*   **user** (required) is the ID of the user
*   **filter** (required) is the ID of the filter to update
*   **name** is the name of the filter
*   **query_from** is a string to match against the From: header
*   **query_to** is a string to match against the To:/Cs: headers
*   **query_subject** is a string to match against the Subject: header
*   **query_text** is a string to match against the message text
*   **query_ha** is a boolean that requires the message to have attachments (true) or not attachments (false)
*   **query_size** is a number that requires the RFC822 message size be larger than (positive integer) or smaller than (negative integer)
*   **action_seen** is a boolean that marks message as seen (true) or unseen (false)
*   **action_flag** is a boolean that marks message as flagged (true) or not (false)
*   **action_delete** is a boolean that makes the message to be deleted immediately (true). This action does not initiate a bounce, the message is dropeed
    silently
*   **action_spam** is a boolean that marks message as spam (true) or not spam (false). Spam messages are automatically moved to the Junk mailbox
*   **action_mailbox** is the mailbox ID the message should me moved to
*   **action_forward** is an email address the message should be forwarded to. You can also mix this action with `delete`.
*   **action_targetUrl** is a web URL the message should be uploaded to

If a key is not included in update payload then the value is left as is. Empty value clears the key if it is set.

**Example**

This example clears query_from, requires messages to have attachments and marks these as spam

```
curl -XPUT "http://localhost:8080/users/59467f27535f8f0f067ba8e6/filters/59759c440e1d676f15e76b5f" -H 'content-type: application/json' -d '{
  "query_from": "",
  "query_ha": true,
  "action_spam": true
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Delete a filter

#### DELETE /users/{user}/filters/{filter}

Deletes a message filter.

**Parameters**

*   **user** (required) is the ID of the user
*   **filter** (required) is the ID of the filter

**Example**

```
curl -XDELETE "http://localhost:8080/users/59467f27535f8f0f067ba8e6/filters/59759c440e1d676f15e76b5f"
```

Response for a successful operation:

```json
{
    "success": true
}
```

## Autoreplies

WildDuck supports setting up autoreply messages that are sent to senders by LMTP process.

### Setup Autoreply

#### PUT /users/{user}/autoreply

This call sets up or updates autoreply message for the user.

**Parameters**

*   **user** (required) is the ID of the user
*   **status** is a boolean that indicates if autoreply messages should be sent (true) or not (false)
*   **subject** is the subject line of autoreply message
*   **text** is text body of the autoreply message
*   **html** is html body of the autoreply message
*   **start** is the start time of the autoreply
*   **end** is the end time of the autoreply

**Response fields**

*   **success** should be `true`

Autoreply update calls can be done partially, eg. only updating status or subject.

**Example**

```
curl -XPUT "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/autoreply" -H 'content-type: application/json' -d '{
  "status": true,
  "subject": "Out of office",
  "text": "I'm out of office this week",
  "start": "2017-11-15T00:00:00.000Z",
  "end": "2017-11-19T00:00:00.000Z",
}'
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Disable Autoreply

#### DELETE /users/{user}/autoreply

You can disable autoreplies either by updating it with status:false or deleting it.

**Parameters**

*   **user** (required) is the ID of the user

**Response fields**

*   **success** should be `true`

**Example**

```
curl -XDELETE "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/autoreply"
```

Response for a successful operation:

```json
{
    "success": true
}
```

### Check Autoreply status

#### GET /users/{user}/autoreply

Return current autoreply status

**Parameters**

*   **user** (required) is the ID of the user

**Response fields**

*   **success** should be `true`
*   **status** is a boolean that indicates if autoreply messages should be sent (true) or not (false)
*   **subject** is the subject line of autoreply message
*   **message** is text body of the autoreply message

**Example**

```
curl "http://localhost:8080/users/5971da1754cfdc7f0983b2ec/autoreply"
```

Response for a successful operation:

```json
{
    "success": true,
    "status": true,
    "subject": "Out of office",
    "message": "I'm out of office this week"
}
```

## Archive

Deleted messages are moved to temporary archive from where these are purged after configured delay (defaults to 2 weeks). During that window it is possible to
list and restore archived messages. Restoring an archived message resets the UID of a message. Archived messages do not count against user quota.

### List archived messages

#### GET /user/{user}/archived

Lists archived messages for an user. This is similar to listing mailbox messages, major difference being that archived message IDs are not numeric but hex
strings

**Parameters**

*   **user** (required) is the ID of the user
*   **order** optional message ordering, either "asc" or "desc". Defaults to "desc" (newer first)

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/archived"
```

Response for a successful operation:

```json
{
    "success": true,
    "total": 1,
    "page": 1,
    "previousCursor": false,
    "nextCursor": false,
    "specialUse": null,
    "results": [
        {
            "id": "5a0d7baa221311cf2d8f145e",
            "mailbox": "59467f27535f8f0f067ba8e6",
            "thread": "5971da7754cfdc7f0983bbde",
            "from": {
                "address": "sender@example.com",
                "name": "Sender Name"
            },
            "subject": "Subject line",
            "date": "2011-11-02T19:19:08.000Z",
            "intro": "Beginning text in the message…",
            "attachments": false,
            "seen": true,
            "deleted": false,
            "flagged": false,
            "draft": false
        }
    ]
}
```

### Get archived message details

#### GET /users/{user}/archived/{message}

Returns data about a specific message. This is similar to listing mailbox message, major difference being that archived message ID is not numeric but a hex
strings

**Parameters**

*   **user** (required) is the ID of the user
*   **message** (required) is the ID of the message

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/archived/5a0d7baa221311cf2d8f145e"
```

Response for a successful operation:

```json
{
    "success": true,
    "id": "5a0d7baa221311cf2d8f145e",
    "from": {
        "address": "sender@example.com",
        "name": "Sender Name"
    },
    "to": [
        {
            "address": "testuser@example.com",
            "name": "Test User"
        }
    ],
    "subject": "Subject line",
    "messageId": "<FA472D2A-092E-44BC-9D38-AFACE48AB98E@example.com>",
    "date": "2011-11-02T19:19:08.000Z",
    "seen": true,
    "deleted": false,
    "flagged": false,
    "draft": false,
    "html": ["Notice that the HTML content is an array of HTML strings"],
    "attachments": []
}
```

### Restore archived message

#### POST /users/{user}/archived/{message}/restore

Restores archived message

**Parameters**

*   **user** (required) is the ID of the user
*   **message** (required) is the ID of the message
*   **mailbox** is an optional ID of the destination mailbox. By default the message is restored to the mailbox it was deleted from or to INBOX if the source
    mailbox does not exist anymore

**Example**

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/archived/5a0d7baa221311cf2d8f145e/restore" -H 'content-type: application/json' -d '{}'
```

Response for a successful operation includes the mailbox ID the message was restored to and the updated UID of the message:

```json
{
    "success": true,
    "mailbox": "5a05ad49484b251f07951b22",
    "uid": 40
}
```

## Quota

### Recalculate user quota

#### POST /users/{user}/quota/reset

Recalculates used storage for an user. Use this when it seems that quota counters for an user do not match with reality.

**Parameters**

*   **user** (required) is the ID of the user

**Example**

```
curl -XPOST "http://localhost:8080/users/59467f27535f8f0f067ba8e6/quota/reset" -H 'content-type: application/json' -d '{}'
```

Response for a successful operation:

```json
{
    "success": true,
    "storageUsed": 128
}
```

Be aware though that this method is not atomic and should be done only if quota counters are way off.

## Updates

Get user related events as an Event Source stream

### Stream update events

#### GET /users/{user}/updates

Streams changes in user account as EventSource stream

**Parameters**

*   **user** (required) is the ID of the user

**Example**

```
curl "http://localhost:8080/users/59467f27535f8f0f067ba8e6/updates"
```

Response stream:

```
data: {"command":"EXISTS", "message":"596e0703f0bdd512aeac3600", "mailbox":"596c9c37ef2213165daadc65",...}
id: 596e0703f0bdd512aeac3605

data: {"command":"CREATE","mailbox":"596e09853f845a14f3620b5c","name":"My Mail",...}
id: 596e09853f845a14f3620b5d
```

First entry in the event stream indicates that a message with id `596e0703f0bdd512aeac3600` was added to mailbox `596c9c37ef2213165daadc65`, second entry
indicates that a new mailbox called _"My Mail"_ with id `596e09853f845a14f3620b5c` was created.

Be aware though that this connection needs to be properly closed if you do not want to end up with memory leaks.
