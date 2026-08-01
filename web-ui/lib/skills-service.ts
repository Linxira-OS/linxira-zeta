import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { getOmpAgentDir as getAgentDir } from "@/lib/file-paths";
import type { SkillInfo } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";

export async function loadSkillsWithInstallInfo(cwd: string) {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload();
  const { skills, diagnostics } = loader.getSkills();
  return {
    skills: annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir }),
    diagnostics,
  };
}
