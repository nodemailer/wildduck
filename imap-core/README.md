# imap-core

Node.js module to create custom IMAP servers.

This is something I have used mostly for client work as the lower level dependency for some specific applications that serve IMAP. I don't have any such clients right no so I published the code if anyone finds it useful. I removed all proprietary code developed for clients, the module is only about the lower level protocol usage and does not contain any actual server logic.

You can see an example implementation of an IMAP server from the [example script](examples/index.js). Most of the code is inherited from the Hoodiecrow test-IMAP server module but this module can be used for asynchronous data access while in Hoodiecrow everything was synchronous (storage was an in-memory object that was accessed and updated synchronously).

## Demo

Install dependencies

    npm install

Run the example

    node examples/index.js

Connect to the server on port 9993

    openssl s_client -crlf -connect localhost:9993

Once connected use testuser:pass to log in

    < * OK test ready
    > A LOGIN testuser pass
    < A OK testuser authenticated

## IMAP extension support

This project is going to support only selected extensions, that are minimally required.

## Sequence number handling

Sequence numbers are handled automatically, no need to do this in the application side – you only need to keep count of the incrementing UID's. All sequence number based operations are converted to use UID values instead.

## Handling large input

Unfortunately input handling for a single command is not stream based, so everything sent to the server is loaded into memory before being processed. Literal size can be limited though and in this case the server refuses to process literals bigger than configured size.

## SEARCH query

Search query is provided as a tree structure.

Possible SEARCH terms

- Array – a list of AND terms
- **or** - in the form of `{key: 'or', value: [terms]}` where _terms_ is a list of OR terms
- **not** - inverts another term. In the form of `{key: 'not', value: term}` where _term_ is the term that must be inverted
- **flag** - describes a flag term. In the form of `{key: 'flag', value: 'term', exists: bool}` where _term_ is the flag name to look for and _bool_ indicates if the flag must be bresent (_true_) or missing (_false_)
- **header** - describes a header value. Header key is a case insensitive exact match (eg. 'X-Foo' matches header 'X-Foo:' but not 'X-Fooz:'). Header value is a partial match. In the form of `{key: 'header', header: 'keyterm', value: 'valueterm'}` where _keyterm_ is the header key name and _valueterm_ is the value of the header. If value is empty then the query acts as boolean, if header key is present, then it matches, otherwise it does not match
- **uid** - is a an array of UID values (numbers)
- **all** - if present then indicates that all messages should match
- **internaldate** - operates on the date the message was received. Date value is day based, so timezone and time should be discarded. In the form of `{key: 'internaldate', operator: 'op', value: 'val'}` where _op_ is one of '<', '=', '>=' and _val_ is a date string
- **date** - operates on the date listed in the massage _Date:_ header. Date value is day based, so timezone and time should be discarded. In the form of `{key: 'date', operator: 'op', value: 'val'}` where _op_ is one of '<', '=', '>=' and _val_ is a date string
- **body** - looks for a partial match in the message BODY (does not match header fields). In the form of `{key: 'body', value: 'term'}` where _term_ is the partial match to look for
- **text** - looks for a partial match in the entire message, including the body and headers. In the form of `{key: 'text', value: 'term'}` where _term_ is the partial match to look for
- **size** - matches message size. In the form of `{key: 'size', value: num, operator: 'op'}` where _op_ is one of '<', '=', '>' and _num_ is the size of the message
- **charset** - sets the charset to be used in the text fields. Can be ignored as everything should be UTF-8 by default

## Currently implemented RFC3501 commands

- **APPEND**
- **CAPABILITY**
- **CHECK**
- **CLOSE**
- **COPY**
- **CREATE**
- **DELETE**
- **EXPUNGE**
- **FETCH**
- **LIST**
- **LOGIN**
- **LOGOUT**
- **LSUB**
- **NOOP**
- **RENAME**
- **SEARCH**
- **SELECT**
- **STARTTLS**
- **STATUS**
- **STORE**
- **SUBSCRIBE**
- **UID COPY**
- **UID STORE**
- **UNSUBSCRIBE**

Extensions

- **Conditional STORE** rfc4551 and **ENABLE**
- **Special-Use Mailboxes** rfc6154
- **ID extension** rfc2971
- **IDLE command** rfc2177
- **NAMESPACE** rfc2342 (hard coded single user namespace)
- **UNSELECT** rfc3691
- **AUTHENTICATE PLAIN** and **SASL-IR**

Unlike the Hoodiecrow project you can not enable or disable extensions, everything is as it is.
