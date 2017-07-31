# Default messages

Add here messages that should be inserted to new users INBOX. Messages are formatted according to [Nodemailer message structure](https://nodemailer.com/message/) and sorted by filename. Only files with .json extension are used.

All string values can take the following template tags (case sensitive):

- **[USERNAME]** will be replaced by the username of the user
- **[DOMAIN]** will be replaced by the service domain
- **[EMAIL]** will be replaced by the email address of the user
- **[NAME]** will be replaced by the registered name of the user
- **[FNAME]** will be replaced by the first part of the registered name of the user

You can also specify some extra options with the mail data object

- **flag** is a boolean. If true, then the message is flagged
- **seen** is a boolean. If true, then the message is marked as seen
- **mailbox** is a string with one of the following values (case insensitive):
  - **'INBOX'** (the default) to store the message to INBOX
  - **'Sent'** to store the message to the Sent Mail folder
  - **'Trash'** to store the message to the Trash folder
  - **'Junk'** to store the message to the Spam folder
  - **'Drafts'** to store the message to the Drafts folder
  - **'Archive'** to store the message to the Archive folder
