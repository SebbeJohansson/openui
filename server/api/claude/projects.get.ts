import type { ClaudeProjectInfo } from '#shared/types/events';
import { ccProjectId } from '#shared/utils/claude-ids';
import { listClaudeProjects } from '../../utils/claude/storage';

export default defineEventHandler(async (): Promise<ClaudeProjectInfo[]> => {
  const projects = await listClaudeProjects();
  return projects.map((project) => ({
    id: ccProjectId(project.id),
    directory: project.directory,
    name: project.directory.split('/').pop() ?? project.directory,
    sessionCount: project.sessions.length,
  }));
});
