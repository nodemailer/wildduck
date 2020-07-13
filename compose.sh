#!/bin/bash
clear
docker-compose down -v --remove-orphans;docker-compose build && docker-compose up -d --force-recreate