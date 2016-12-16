#!/bin/bash

set -e

ORG_TITLE=ORG_ID: 

OLD_ORG_ID=$(grep "ORG_ID:" manifest.yml)

OLD_ORG_ID="$(echo -e "${OLD_ORG_ID}" | sed -e 's/^[[:space:]]*//')"

NEW_ORG_ID="$ORG_TITLE $(cf org $(cf target | awk '{if (NR == 4) {print $2}}') --guid)" 

sed -i "s/$OLD_ORG_ID/$NEW_ORG_ID/g" manifest.yml

cf push --no-start
