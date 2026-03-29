#!/bin/bash

set -euo pipefail

# npm create vite@latest app -- --template react-ts

# brew install mkcert
# brew install caddy
# mkcert -install
# echo "127.0.0.1 bacondegrees420.web.app" | sudo tee -a /etc/hosts
# mkcert bacondegrees420.web.app
# echo -e "{\nhttps://bacondegrees420.web.app {\n tls bacondegrees420.web.app.pem bacondegrees420.web.app-key.pem\n reverse_proxy 127.0.0.1:5173\n}\n}" > Caddyfile
# sudo caddy run --config Caddyfile

cd app
npm install
npm test
yarn build
rm -rf node_modules
