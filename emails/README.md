# Default messages

Add here default email messages that should be inserted to new users account. To test it out, rename example.json.disabled to example.json, restart WildDuck and create a new account. Your INBOX should include the message composed from the example.

## Creating default messages

Messages are formatted according to the [Nodemailer message structure](https://nodemailer.com/message/) and stored to this folder as json files.

All string values in the JSON structure can use the following template tags (case sensitive) that are replaced while compiling:

* **[USERNAME]** will be replaced by the username of the user
* **[EMAIL]** will be replaced by the email address of the user
* **[DOMAIN]** will be replaced by the domain part of the email address
* **[NAME]** will be replaced by the registered name of the user
* **[FNAME]** will be replaced by the first name of the registered user
* **[LNAME]** will be replaced by the last name of the registered user

> NB! All values are replaced as is, except in the `html` field. For `html` the replaced values are html encoded.

You can also specify some extra options with the mail data object

* **flag** is a boolean. If true, then the message is flagged
* **seen** is a boolean. If true, then the message is marked as seen
* **mailbox** is a string with one of the following values (case insensitive):
    * **'INBOX'** (the default) to store the message to INBOX
    * **'Sent'** to store the message to the Sent Mail folder
    * **'Trash'** to store the message to the Trash folder
    * **'Junk'** to store the message to the Spam folder
    * **'Drafts'** to store the message to the Drafts folder
    * **'Archive'** to store the message to the Archive folder

You can include some resources as external files by using the same name prefix as the main json file. Name prefix can be anything, it is used to sort the messages (if you want to insert multiple messages at once) and also to group resources related to that message.

* **name.json** is the main message file, this includes the general message structure
* **name.html** or **name.htm** is the HTML content of the message. If this file exists then it sets or overrides the `html` property in message json structure
* **name.text** or **name.txt** is the plaintext content of the message. If this file exists then it sets or overrides the `text` property in message json structure
* **name.filename.ext** is included in the message as an attachment

### Embedded images

You can link the attachment files to HTML as images. For this either use the canonical name of the attachment (eg. "duck.png") or the filename of the attachment in the emails folder (eg "example.duck.png"). Make sure that the URL used in HTML does not use full path, it must point to the current folder.

```html
<img src="/path/to/duck.png"> <!-- BAD, path is not allowed -->
<img src="duck.png"> <!-- GOOD, canonical attachment name -->
<img src="example.duck.png"> <!-- GOOD, actual filename in folder -->
<img src="./duck.png"> <!-- Not GOOD but works as leading ./ is removed from the filename -->
```
