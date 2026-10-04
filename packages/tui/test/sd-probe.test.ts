import { VirtualTerminal } from "./virtual-terminal";

// Probe: does CSI T (SD) pull scrollback back into the viewport in kitty-vt-wasm?
const term = new VirtualTerminal(10, 4);
// Fill 6 rows so 2 scroll off into history.
term.write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n");
console.log("after writes, viewport:", JSON.stringify(term.getViewport().map(r => Bun.stripANSI(r))));
console.log("scrollback:", JSON.stringify(term.getScrollBuffer().map(r => Bun.stripANSI(r).trimEnd())));
// Scroll down 1 (xterm-style SD).
term.write("\x1b[1T");
console.log("after CSI 1 T, viewport:", JSON.stringify(term.getViewport().map(r => Bun.stripANSI(r))));
// kitty SD+ (fill from scrollback).
term.write("\x1b[1+T");
console.log("after CSI 1 + T, viewport:", JSON.stringify(term.getViewport().map(r => Bun.stripANSI(r))));
