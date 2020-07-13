#!/bin/bash
clear

((minutes=$(date +%s)/60))

tag=`cut -d ":" -f2- <<< $(sed "3q;d" package.json )`-$minutes;
tag="${tag// /}"
tag="${tag//\"/}"
tag="${tag//,/}"

if [ ! -z "$DOCKER_USERNAME" ] && [ ! -z "$DOCKER_PASSWORD" ] ; then
    docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"
    docker build --rm -t figassis/wildduck:$tag . && docker push figassis/wildduck:$tag
fi
