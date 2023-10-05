# Changelog

## [1.40.3](https://github.com/nodemailer/wildduck/compare/v1.40.2...v1.40.3) (2023-10-05)


### Bug Fixes

* **docker:** trying to get release building working ([761f5fa](https://github.com/nodemailer/wildduck/commit/761f5fa18d1260f8dcf5dbb2dcaab078c4d90aab))

## [1.40.2](https://github.com/nodemailer/wildduck/compare/v1.40.1...v1.40.2) (2023-10-05)


### Bug Fixes

* fixed typo validateSequnce &gt; validateSequence (closes [#518](https://github.com/nodemailer/wildduck/issues/518)) ([#520](https://github.com/nodemailer/wildduck/issues/520)) ([8766ab9](https://github.com/nodemailer/wildduck/commit/8766ab9cf50c624d7f1f94ed7136d71387762449))
* **pop3:** run socket.destroy() if pop3 socket is not closed in 1.5s ([2de6c0b](https://github.com/nodemailer/wildduck/commit/2de6c0bc128424e97b53d98239738c9c1c362e0c))

## [1.40.1](https://github.com/nodemailer/wildduck/compare/v1.40.0...v1.40.1) (2023-10-04)


### Bug Fixes

* **debug:** replaced SIGPIPE with SIGHUP to generate snapshots ([7a30ed7](https://github.com/nodemailer/wildduck/commit/7a30ed7861166e92f63e9157f3b1719957cd8520))
* **sending:** Do not count sending limits twice ([#505](https://github.com/nodemailer/wildduck/issues/505)) ([b9349f6](https://github.com/nodemailer/wildduck/commit/b9349f6e8315873668d605e6567ced2d7b1c0c80))

## [1.40.0](https://github.com/nodemailer/wildduck/compare/v1.39.15...v1.40.0) (2023-09-28)


### Features

* **storage:** Added cid property to storage files ([#502](https://github.com/nodemailer/wildduck/issues/502)) ([80797ee](https://github.com/nodemailer/wildduck/commit/80797eebec9f11df3b63b52575609610aa8bfd0c))


### Bug Fixes

* **index:** removed unneeded related_attachments index ([81ec8ca](https://github.com/nodemailer/wildduck/commit/81ec8ca2f59f083c1ded6814ca98076e2e1ee44c))
* **test:** Added POST storage test ([#492](https://github.com/nodemailer/wildduck/issues/492)) ([1c17f5f](https://github.com/nodemailer/wildduck/commit/1c17f5fefc456e95a1f226ca826a273ca07336c4))

## [1.39.15](https://github.com/nodemailer/wildduck/compare/v1.39.14...v1.39.15) (2023-09-05)


### Bug Fixes

* **ci:** Added NPM release workflow ([f4cdbb2](https://github.com/nodemailer/wildduck/commit/f4cdbb2ba5f9607dc6ca521cfcbaaed14d338bef))
* **ci:** Added NPM release workflow ([326ed59](https://github.com/nodemailer/wildduck/commit/326ed59bb94cac6e462b2a503a26eaafd0137093))
* **release:** Added package-lock required for pubslishing ([6b42cc5](https://github.com/nodemailer/wildduck/commit/6b42cc5c289645299d14e08ae42c75aecabf3217))
* **release:** updated repo url for automatic publishing ([48ce200](https://github.com/nodemailer/wildduck/commit/48ce2005be143767f53d8251d0b40e9661c31930))
