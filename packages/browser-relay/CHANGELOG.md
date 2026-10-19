## [Unreleased]
### Fixed

- Fixed a relay tab close failing when Chrome refuses it for a moment (a tab being dragged); the extension retries it ([#16119](https://github.com/can1357/oh-my-pi/pull/16119) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed tabs created for a relay request whose connection dropped mid-create staying open, and answers to such requests going to a later connection ([#16119](https://github.com/can1357/oh-my-pi/pull/16119))
- Fixed the relay resolving an old tab id to a different tab after a browser restart; the extension now reports each browser run ([#16119](https://github.com/can1357/oh-my-pi/pull/16119))
## [1.0.2] - 2026-08-15
