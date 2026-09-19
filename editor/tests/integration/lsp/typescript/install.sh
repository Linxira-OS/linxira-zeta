#!/bin/bash
set -e
# typescript-language-server needs classic TS5 (has lib/tsserver.js);
# `typescript` latest is now the TS7 native rewrite, which lacks it.
npm install -g typescript@5 typescript-language-server
