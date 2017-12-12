#!/bin/bash

DBNAME="$1"

echo "Clearing DB"
mongo "$DBNAME" --eval "db.getCollectionNames().forEach(function(key){db[key].deleteMany({});})" > /dev/null

echo "Creating user"
USERRESPONSE=`curl --silent -XPOST http://localhost:8080/users \
-H 'Content-type: application/json' \
-d '{
  "username": "testuser",
  "password": "pass",
  "name": "Test User"
}'`
echo "UR: $USERRESPONSE"
USERID=`echo "$USERRESPONSE" | jq -r '.id'`

echo "Reading Mailbox ID"
MAILBOXLIST=`curl --silent "http://localhost:8080/users/$USERID/mailboxes"`
echo "ML: $MAILBOXLIST"
echo "$MAILBOXLIST" | jq
INBOXID=`echo "$MAILBOXLIST" | jq -r '.results[0].id'`
SENTID=`echo "$MAILBOXLIST" | jq -r '.results[3].id'`

curl --silent -XPUT "http://localhost:8080/users/$USERID/mailboxes/$SENTID" \
-H 'Content-type: application/json' \
-d '{
  "path": "[Gmail]/Sent Mail"
}'

MAILBOXLIST=`curl --silent "http://localhost:8080/users/$USERID/mailboxes"`
echo "$MAILBOXLIST" | jq

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?date=14-Sep-2013%2021%3A22%3A28%20-0300&unseen=true" \
	-H 'Content-type: message/rfc822' \
	--data-binary "@fixtures/fix1.eml"

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?unseen=false" \
	-H 'Content-type: message/rfc822' \
	--data-binary "@fixtures/fix2.eml"

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?unseen=false" \
	-H 'Content-type: message/rfc822' \
	--data-binary "@fixtures/fix3.eml"

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?unseen=true" \
	-H 'Content-type: message/rfc822' \
	--data-binary "@fixtures/fix4.eml"

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?unseen=true" \
	-H 'Content-type: message/rfc822' \
	--data-binary "from: sender@example.com
to: receiver@example.com
subject: test5

hello 5
"

curl --silent -XPOST "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages?unseen=true" \
	-H 'Content-type: message/rfc822' \
	--data-binary "from: sender@example.com
to: receiver@example.com
subject: test6

hello 6
"

mongo "$DBNAME" --eval "db.messages.updateOne({uid:1}, {\$set:{modseq: 100}})" > /dev/null
mongo "$DBNAME" --eval "db.messages.updateOne({uid:2}, {\$set:{modseq: 5000}})" > /dev/null

# curl --silent "http://localhost:8080/users/$USERID/mailboxes/$INBOXID/messages" | jq
