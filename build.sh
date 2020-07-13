#!/bin/bash
clear

((minutes=$(date +%s)/60))

tag=`cut -d ":" -f2- <<< $(sed "3q;d" package.json )`-$minutes;
tag="${tag// /}"
tag="${tag//\"/}"
tag="${tag//,/}"

if [ ! -z "$DOCKER_USERNAME" ] && [ ! -z "$DOCKER_PASSWORD" ] && [ ! -z "$IMAGE_NAME" ]; then
    docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"
    docker build --rm -t $IMAGE_NAME:$tag . && docker push $IMAGE_NAME:$tag
fi
