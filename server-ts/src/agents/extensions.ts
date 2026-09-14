import type { Sql } from '../db/pool.ts';
import type { McpServerRepository } from '../mcp/repository.ts';
import type { McpTransport } from '../runtime/envelope.ts';
import type { SkillRepository } from '../skills/repository.ts';
import type { AgentProfileRepository } from './profile.ts';

/** Identical to A's `SkillRef` (runtime/envelope.ts), so it drops straight into `agent.skills`. */
export interface EnvelopeSkill {
   name: string;
   files: { path: string; content: string }[];
}

/** Identical to A's `McpServerRef`, so it drops straight into `agent.mcpServers`. */
export interface EnvelopeMcpServer {
   name: string;
   url: string;
   transport: McpTransport;
   headers: Record<string, string>;
   /** Null: a server the workspace registered exposes all its tools. */
   allowedTools: string[] | null;
}

export function skillManifest(skill: { name: string; description: string; content: string }): string {
   return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n${skill.content}`;
}

export interface AgentExtensions {
   skills: EnvelopeSkill[];
   mcpServers: EnvelopeMcpServer[];
   env: Record<string, string>;
   /** Servers left out, by name: gateway-routed with no gateway configured. */
   skipped: string[];
}

export interface GatewayRoute {
   url: string;
   headers: () => Promise<Record<string, string>>;
}

export interface ExtensionDeps {
   sql: Sql;
   skills: SkillRepository;
   mcp: McpServerRepository;
   profile: AgentProfileRepository;
   gateway: GatewayRoute | null;
}

/**
 * Everything the agent carries into one task, beyond its instructions.
 *
 * The only place sealed env and MCP headers are opened, and the result goes
 * straight into the envelope (spec §11): never into a row, a log or a response.
 *
 * A server marked `viaGateway` goes through the AgentCore Gateway when one is
 * configured and is otherwise left out, never sent direct: the admin asked
 * for it to pass the gateway's policy.
 */
export async function loadAgentExtensions(
   deps: ExtensionDeps,
   input: { workspaceId: string; agentId: string; issueId: string | null }
): Promise<AgentExtensions> {
   const [skills, servers, env] = await Promise.all([
      deps.skills.enabledForAgent(input.workspaceId, input.agentId),
      deps.mcp.forAgent(input.workspaceId, input.agentId),
      deps.profile.envFor(input.workspaceId, input.agentId),
   ]);

   const mcpServers: EnvelopeMcpServer[] = [];
   const skipped: string[] = [];
   for (const server of servers) {
      if (!server.viaGateway) {
         mcpServers.push({
            name: server.name,
            url: server.url,
            transport: server.transport,
            headers: server.headers,
            allowedTools: null,
         });
      } else if (deps.gateway) {
         mcpServers.push({
            name: server.name,
            url: deps.gateway.url,
            transport: 'streamable_http',
            headers: await deps.gateway.headers(),
            allowedTools: null,
         });
      } else {
         skipped.push(server.name);
      }
   }

   return {
      skills: skills.map((skill) => ({
         name: skill.name,
         files: [
            { path: 'SKILL.md', content: skillManifest(skill) },
            ...skill.fileContents.filter((file) => file.path !== 'SKILL.md'),
         ],
      })),
      mcpServers,
      env,
      skipped,
   };
}
