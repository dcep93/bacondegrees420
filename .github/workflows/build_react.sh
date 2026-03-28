#!/bin/bash

set -euo pipefail

# npm create vite@latest app -- --template react-ts

cd app
npm install
npm test
yarn build
rm -rf node_modules
