# Contributing to omp-web

Thank you for considering contributing to `omp-web`!

## Getting Started

1. Fork the repository and clone your fork locally.
2. Ensure Node.js >= 18.3.0 is installed.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the local development server:
   ```bash
   npm run dev
   ```

## Development Guidelines

- **TypeScript & Linting**: Always verify your code passes type checks and linter rules before submitting a PR:
  ```bash
  npx tsc --noEmit
  npm run lint
  ```
- **Dev Server Caution**: Do NOT run `next build` during development as it pollutes `.next/` and breaks `npm run dev`.
- **Code Style**: Follow existing project conventions. Keep components clean, modular, and performance-conscious.

## Submitting a Pull Request

1. Create a descriptive branch name (`git checkout -b feat/my-feature` or `git checkout -b fix/my-bug`).
2. Commit your changes with clear, concise commit messages.
3. Push to your fork and open a Pull Request against `main`.
