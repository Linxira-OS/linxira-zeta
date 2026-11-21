#!/usr/bin/env node
"use strict";
// `zetawork` — the workbench bin: a bare invocation opens the workspace.
const { launch, ENTRY_WORKBENCH } = require("./launch");

launch(ENTRY_WORKBENCH, process.argv.slice(2));
