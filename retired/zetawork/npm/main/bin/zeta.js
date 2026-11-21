#!/usr/bin/env node
"use strict";
// `zeta` — the suite index bin: a bare invocation prints the help that lists
// `zetawork`, `zetacode` and `zetaide` (the workspace itself opens with
// `zetawork`).
const { launch, ENTRY_INDEX } = require("./launch");

launch(ENTRY_INDEX, process.argv.slice(2));
