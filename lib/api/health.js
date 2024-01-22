'use strict';

const Joi = require('joi');
const tools = require('../tools');
const { successRes } = require('../schemas/response/general-schemas');

module.exports = (db, server) => {
    server.get(
        {
            path: '/health',
            summary: 'Check the health of the API',
            description: 'Check the status of the WildDuck API service, that is if db is connected and readable/writable, same for redis.',
            tags: ['Health'],
            validationObjs: {
                requestBody: {},
                queryParams: {},
                pathParams: {},
                response: {
                    200: {
                        description: 'Success',
                        model: Joi.object({ success: successRes })
                    },
                    500: {
                        description: 'Failed',
                        model: Joi.object({ success: successRes, message: Joi.string().required().description('Error message specifying what went wrong') })
                    }
                }
            }
        },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const currentTimestamp = Date.now() / 1000;

            // 1) test that mongoDb is up
            try {
                const isConnected = await db.database.s.client.topology.isConnected();

                if (!isConnected) {
                    res.status(500);
                    return res.json({
                        success: false,
                        message: 'DB is down'
                    });
                }
            } catch (err) {
                res.status(500);
                return res.json({
                    success: false,
                    message: 'DB is down'
                });
            }

            // 2) test that mongoDb is writeable

            try {
                await db.database.collection(`${currentTimestamp}`).insert({ a: 'testWrite' });
                await db.database.collection(`${currentTimestamp}`).deleteOne({ a: 'testWrite' });
            } catch (err) {
                res.status(500);
                return res.json({
                    success: false,
                    message: 'Could not write to DB'
                });
            }

            // 3) test redis PING
            db.redis.ping(err => {
                if (err) {
                    res.status(500);
                    return res.json({
                        success: false,
                        message: 'Redis is down'
                    });
                }
            });

            // 4) test if redis is writeable
            try {
                await db.redis.set(`${currentTimestamp}`, 'testVal');
                await db.redis.get(`${currentTimestamp}`);
                await db.redis.del(`${currentTimestamp}`);
            } catch (err) {
                res.status(500);
                return res.json({
                    success: false,
                    message: 'Redis is not writeable/readable'
                });
            }

            res.status(200);
            return res.json({ success: true });
        })
    );
};
