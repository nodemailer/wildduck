# Security implementation

## Passwords

User password is hashed with pbkdf2 or bcrypt (pbkdf2 is preferred as it can be used through built-in crypto API while bcrypt requires slower js-only implementation). Password hash is stored in the user entry in the users database.

## 2FA

Wild Duck generates random TOTP seed tokens. These are encrypted (using "aes192" cipher by default) with a master password configured in application settings. Encrypted TOTP seed is stored in the user entry in the users database.

If 2FA is enabled then account password can only be used for the "master" scope but not for IMAP, POP3 or SMTP scopes. In these cases the user must generate an Application Specific Password for the required scope(s).

## Application Specific Passwords

Application Specific Passwords are 16 byte strings, consisting of lowercase random latin characters. ASPs can include additional whitespace symbols as all whitespace symbols are removed from the password before doing any validations with it (this behavior does not extend to the account password where whitespace symbols matter). ASPs are stored as separate _asp_ entries in the users database.

ASPs are hashed with bcrypt, using 12 rounds. Additionally the 4 first symbols of the ASP are hashed with md5. This is needed to detect potential ASPs when authenticating (user password is compared against only these ASPs that have a matching md5 hash of the 4 first characters).

ASPs have a scope set (an array of strings). When authenticating then the authentication only succeeds if the requested scope matches. ASP can never be used for the "master" scope, this scope is only allowed for the account password.

## Authentication rate limiting

Both password and TOTP checks are rate limited. By default it is allowed to make 5 invalid password authentications in 60 seconds until the account is locked for the rest of the 60 second time window. TOTP checks are counted separately, there are allowed 6 invalid checks in 180 second window. Successful authentication clears rate limiting values for that account. Time window starts from the first failed authentication attempt.

## PGP

Wild Duck is able to encrypt all added messages with users public PGP key, this includes messages received via LMTP, messages uploaded from IMAP (Drafts, Sent Mail etc.) and messages uploaded by the MSA (if using zonemta-wildduck).

## Auditing

Authentication related events (this also includes modifications in authentication information) are logged and logs are kept for 30 days. Authentication event includes action (eg. "authentication"), result (eg. "success"), IP address and a few other values.

## Role based tokens

By default a root token is used for validating API calls. You can use role based and user bound tokens instead to limit damage in case tokens are leaked. Read about tokens [here](in-depth/roles.md).
