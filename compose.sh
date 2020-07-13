#!/bin/bash
clear
mkdir -p data
cp config/api.toml data/
cp config/dbs.toml data/

sed -i '' 's|mongodb://127.0.0.1:27017/wildduck|mongodb://wildduck_mongo_1:27017/wildduck|' data/dbs.toml
sed -i '' 's|host="127.0.0.1"|host="wildduck_redis_1"|' data/dbs.toml
sed -i '' 's|host="127.0.0.1"|host="0.0.0.0"|' data/api.toml

docker-compose down -v --remove-orphans;docker-compose build && docker-compose up -d --force-recreate