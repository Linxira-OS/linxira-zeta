/**
 * @linxiraos/studio-contract — local subset for terminal/frontend/zeta-pages.
 *
 * The Team/Rooms pages keep importing from `@linxiraos/studio-contract`; the
 * Vite config and tsconfig map that specifier here, so the standalone entry
 * never reaches into web-app or packages/* source. Only the types the pages
 * and the local browser transport need are present.
 */
export const CLIENT_CONTRACT_VERSION = 2 as const;

export * from "./ids";
export * from "./read-models";
export * from "./operations";
export * from "./team";
