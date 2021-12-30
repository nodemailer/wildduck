'use strict';

const crypto = require('crypto');
const config = require('wild-config');
const { ObjectId } = require('mongodb');
const db = require('./db');
const { ACCESS_TOKEN_MAX_LIFETIME } = require('./consts');
const Boom = require('@hapi/boom');

async function deleteAccessToken(accessToken) {
    if (!accessToken || accessToken.length !== 40 || !/^[a-fA-F0-9]{40}$/.test(accessToken)) {
        // not a valid token
        return false;
    }

    let tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    let tokenKey = `tn:token:${tokenHash}`;

    let result;
    try {
        result = await db.redis.del(tokenKey);
    } catch (err) {
        let error = Boom.boomify(new Error('Internal database error'), { statusCode: 500 });
        error.output.payload.code = 'InternalDatabaseError';
        throw error;
    }

    return result;
}

async function checkAccessToken(accessToken) {
    if (!accessToken || accessToken.length !== 40 || !/^[a-fA-F0-9]{40}$/.test(accessToken)) {
        // not a valid token
        return { user: false, role: false };
    }

    let role;
    let user;
    let tokenData;

    let tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    let tokenKey = `tn:token:${tokenHash}`;

    try {
        tokenData = await db.redis.hgetall(tokenKey);
    } catch (err) {
        let error = Boom.boomify(new Error('Internal database error'), { statusCode: 500 });
        error.output.payload.code = 'InternalDatabaseError';
        console.log('THROW 1', err);
        throw error;
    }

    if (tokenData && tokenData.user && tokenData.role && config.api.roles[tokenData.role]) {
        let signData;
        if ('authVersion' in tokenData) {
            // cast value to number
            tokenData.authVersion = Number(tokenData.authVersion) || 0;
            signData = {
                token: accessToken,
                user: tokenData.user,
                authVersion: tokenData.authVersion,
                role: tokenData.role
            };
        } else {
            signData = {
                token: accessToken,
                user: tokenData.user,
                role: tokenData.role
            };
        }

        let signature = crypto.createHmac('sha256', config.api.accessControl.secret).update(JSON.stringify(signData)).digest('hex');

        if (signature !== tokenData.s) {
            // rogue token or invalidated secret
            try {
                await db.redis.multi().del(tokenKey).exec();
            } catch (err) {
                // ignore
            }
        } else if (tokenData.ttl && !isNaN(tokenData.ttl) && Number(tokenData.ttl) > 0) {
            let tokenTTL = Number(tokenData.ttl);
            let tokenLifetime = config.api.accessControl.tokenLifetime || ACCESS_TOKEN_MAX_LIFETIME;

            // check if token is not too old
            if ((Date.now() - Number(tokenData.created)) / 1000 < tokenLifetime) {
                // token is still usable, increase session length
                try {
                    await db.redis.multi().expire(tokenKey, tokenTTL).exec();
                } catch (err) {
                    // ignore
                }

                role = tokenData.role;
                user = tokenData.user;
            } else {
                // expired token, clear it
                try {
                    await db.redis.multi().del(tokenKey).exec();
                } catch (err) {
                    // ignore
                }
            }
        } else {
            role = tokenData.role;
            user = tokenData.user;
        }

        if (!role || !user) {
            return { user: false, role: false };
        }

        if (tokenData.authVersion && /^[0-9a-f]{24}$/i.test(user)) {
            let tokenAuthVersion = Number(tokenData.authVersion) || 0;
            let userData = await db.users.collection('users').findOne(
                {
                    _id: new ObjectId(user)
                },
                {
                    projection: {
                        authVersion: true
                    }
                }
            );

            let userAuthVersion = Number(userData && userData.authVersion) || 0;
            if (!userData || tokenAuthVersion < userAuthVersion) {
                // unknown user or expired session
                try {
                    await db.redis.multi().del(tokenKey).exec();
                } catch (err) {
                    // ignore
                }

                return { user: false, role: false };
            }
        }
    }

    return { user: user || false, role: role || false };
}

module.exports = { checkAccessToken, deleteAccessToken };
