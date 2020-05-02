# FAQ

## Does it work?

Yes, it does. You can run the server and get working IMAP and POP3 servers for mail store, LMTP server for pushing messages to the mail store and
[HTTP API](//docs.wildduck.email/api) server to create new users. All handled by Node.js, MongoDB and Redis, no additional dependencies needed. Provided
services can be disabled and enabled one by one so, for example you could process just IMAP in one host and LMTP in another.

## How is security implemented in WildDuck?

Read about the WildDuck security implementation [here](in-depth/security.md).

## Isn't it bad to use a database as a mail store?

Yes, historically it has [been considered a bad practice](http://www.memoryhole.net/~kyle/databaseemail.html) to store emails in a database. And for a good
reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact document stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and
while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message. Additionally there's nothing too GridFS
specific, so (at least in theory) it could be replaced with any object store.

Here's a list of alternative email servers that also use a database for storing email messages:

-   [DBMail](http://www.dbmail.org/) (MySQL, IMAP)
-   [Archiveopteryx](http://archiveopteryx.org/) (PostgreSQL, IMAP)
-   [ElasticInbox](http://www.elasticinbox.com/) (Cassandra, POP3)

## How does it work?

Whenever a message is received WildDuck parses it into a tree-like structure based on the MIME tree and stores this tree to MongoDB. Attachments are removed
from the tree and stored separately in GridStore. If a message needs to be loaded then WildDuck fetches the tree structure first and, if needed, loads
attachments from GridStore and then compiles it back into the original RFC822 message. The result should be identical to the original messages unless the
original message used unix newlines, these might be partially replaced with windows newlines.

WildDuck tries to keep minimal state for sessions (basically just a list of currently known UIDs and latest MODSEQ value) to be able to distribute sessions
between different hosts. Whenever a mailbox is opened the entire message list is loaded as an array of UID values. The first UID in the array element points to
the message nr. 1 in IMAP, second one points to message nr. 2 etc.

Actual update data (information about new and deleted messages, flag updates and such) is stored to a journal log and an update beacon is propagated through
Redis pub/sub whenever something happens. If a session detects that there have been some changes in the current mailbox and it is possible to notify the user
about it (eg. a NOOP call was made), journaled log is loaded from the database and applied to the UID array one action at a time. Once all journaled updates
have applied then the result should match the latest state. If it is not possible to notify the user (eg a FETCH call was made), then journal log is not loaded
and the user continues to see the old state.