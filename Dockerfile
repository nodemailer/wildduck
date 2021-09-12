FROM node:lts-alpine

RUN apk add --no-cache make git dumb-init python openssl

WORKDIR /wildduck

COPY package*.json ./
RUN npm install --production

COPY . .


ENV WILDDUCK_APPDIR=/wildduck \
    WILDDUCK_CONFIG=/wildduck/config/default.toml \
    CMD_ARGS=""

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD node ${WILDDUCK_APPDIR}/server.js --config=${WILDDUCK_CONFIG} ${CMD_ARGS}
