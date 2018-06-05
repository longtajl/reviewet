#!/bin/sh

. env.sh

echo "CLIENT_ID="$CLIENT_ID
echo "CLIENT_SECRET="$CLIENT_SECRET
echo "REDIRECT_URI="REDIRECT_URI
echo "SCOPE="$SCOPE

echo ">>>>>>>>> this URL Please access by browser "
echo "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&scope=$SCOPE&access_type=offline" 

