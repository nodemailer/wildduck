# Auditing

WildDuck email server has built in auditing capabilities. Special auditing interface allows email admins to enable auditing for specific accounts. Audited messages are copied, not linked, so if an email is deleted from the email account then the copy still remains in auditing. Audit includes only messages from a select time frame, which allows exposing only a limited set of messages to the auditor. All copied messages are automatically deleted and auditor access is revoked once the audit has expired.

Admins can also create designated access credentials (encrypted with PGP keys) but can not access any email content directly. Once auditor receives the encrypted credentials they can decrypt these into a CSV file. Auditor can then access message listing, message metadata. They can also download single emails or ZIP bundles with multiple or all emails. Emails are also searchable by addresses, date and subject.

[Demo](https://www.youtube.com/watch?v=pF4JqbNLfSo)
