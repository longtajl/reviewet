#!/bin/sh

cd `dirname $0`

. env.sh

REFRESH_TOKEN=
curl --data "refresh_token=$REFRESH_TOKEN" --data "client_id=$CLIENT_ID" --data "client_secret=$CLIENT_SECRET" --data "grant_type=refresh_token" https://www.googleapis.com/oauth2/v4/token | jq '.access_token' | awk '{gsub("\"","",$0);print $0}' > ../api.token 
