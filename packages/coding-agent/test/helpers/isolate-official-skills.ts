import path from "node:path";

// Point the official bundled skills provider at a nonexistent path for the
// whole test process. Chunked CI runs load many test files into one process;
// without this, any test that exercises global skill discovery leaks
// skills/official/docx + pptx into prelude/command-list assertions of
// unrelated suites in the same chunk. official-skills.test.ts opts back in by
// setting the env var before dynamically importing discovery/builtin.
process.env.ZETA_OFFICIAL_SKILLS_DIR = path.join(path.dirname(process.execPath), "__zeta_test_no_official_skills__");
