# Operating WildDuck

## Logging

WildDuck sends gelf-formatted log messages to a Graylog server. Set `log.gelf.enabled=true` in [config](https://github.com/nodemailer/wildduck/blob/2019fd9db6bce1c3167f08e363ab4225b8c8a296/config/default.toml#L59-L66) to use it. Also make sure that the same Gelf settings are set for _zonemta-wildduck_ and _haraka-plugin-wildduck_ in order to get consistent logs about messages throughout the system.

> Graylog logging replaces previously used 'messagelog' database collection

## Testing

Create an email account and use your IMAP client to connect to it. To send mail to this account, run the example script:

```
node examples/push-message.js username@example.com
```

This should "deliver" a new message to the INBOX of _username@example.com_ by using the built-in LMTP maildrop interface. If your email client is connected then
you should promptly see the new message.

## Import from maildir

There is a tool to import emails from an existing maildir to WildDuck email database. See the tool [here](https://github.com/nodemailer/import-maildir)

## Sharding

WildDuck supports MongoDB sharding. Consider using sharding only if you know that your data storage is large enough to outgrow single replica. Some actions
require scattered queries to be made that might be a hit on performance on a large cluster but most queries include the shard key by default.

Shard the following collections by these keys (assuming you keep attachments in a separate database):

```javascript
sh.enableSharding('wildduck');
// consider using mailbox:hashed for messages only with large shard chunk size
sh.shardCollection('wildduck.messages', { mailbox: 1, uid: 1 });
sh.shardCollection('wildduck.archived', { user: 1, _id: 1 });
sh.shardCollection('wildduck.threads', { user: 'hashed' });
sh.shardCollection('wildduck.authlog', { user: 'hashed' });

sh.enableSharding('attachments');
// attachment _id is a sha256 hash of attachment contents
sh.shardCollection('attachments.attachments.files', { _id: 'hashed' });
sh.shardCollection('attachments.attachments.chunks', { files_id: 'hashed' });

// storage _id is an ObjectID
sh.shardCollection('attachments.storage.files', { _id: 'hashed' });
sh.shardCollection('attachments.storage.chunks', { files_id: 'hashed' });
```

If using [auditing](additional-software/auditing.md) then shard audit collections as well

```
sh.shardCollection('attachments.audit.files', { _id: 'hashed' });
sh.shardCollection('attachments.audit.chunks', { files_id: 'hashed' });
```

## Disk usage

Tests show that the ratio of attachment contents vs other stuff is around 1:10. This means that you can split your database between multiple disks by using
smaller SSD (eg. 150GB) for message data and indexes and a larger and cheaper SATA (eg. 1TB) for attachment contents. This assumes that you use WiredTiger with
`storage.directoryPerDB:true` and `storage.wiredTiger.engineConfig.directoryForIndexes:true`

Assuming that you use a database named `attachments` for attachment contents:

    SSD mount : /var/lib/mongodb
    SATA mount: /var/lib/mongodb/attachments/collection

MongoDB does not complain about existing folders so you can prepare the mount before even installing MongoDB.

## Redis Sentinel

WildDuck is able to use Redis Sentinel instead of single Redis master for automatic failover. When using Sentinel and the Redis master fails then it might take
a moment until new master is elected. Pending requests are cached during that window, so most operations should succeed eventually. You might want to test
failover under load though, to see how it behaves.

Redis Sentinel failover does not guarantee consistency. WildDuck does not store critical information in Redis, so even if some data loss occurs, it should not
be noticeable.

## HAProxy

When using HAProxy you can enable PROXY protocol to get correct remote addresses in server logs. You can use the most basic round-robin based balancing as no
persistent sessions against specific hosts are needed. Use TCP load balancing with no extra settings both for plaintext and TLS connections.

If TLS is handled by HAProxy then use the following server config to indicate that WildDuck assumes to be a TLS server but TLS is handled upstream

```toml
[imap]
secure=true # this is a TLS server
secured=true # TLS is handled upstream

[pop3]
secure=true # this is a TLS server
secured=true # TLS is handled upstream
```

## Certificates

You can live-reload updated certificates by sending SIGHUP to the master process. This causes application configuration to be re-read from the disk. Reloading
only affects only some settings, for example all TLS certificates are loaded and updated. In this case existing processes continue as is, while new ones use the
updated certs.

Beware though that if configuration loading fails, then it ends with an exception. Make sure that TLS certificate files are readable for the WildDuck user.
