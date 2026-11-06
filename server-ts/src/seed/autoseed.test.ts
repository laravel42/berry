import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { CORE_ROLES } from '../organization/catalog.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { addRole } from '../organization/provision.ts';
import { autoseedWorkspace, bindRolePackSkills, seedWorkspaceDefaults } from './deploy.ts';
import { SKILLS_PER_ROLE, type PackedSkill } from './skill-pack.ts';
import { loadPackedSkills } from './skills.ts';

const MIGRATION_248 = new URL('../../migrations/248_role_agents_own_skills.up.sql', import.meta.url);

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('autoseedWorkspace', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;
   let userId: string;
   let boardId: string;

   const pack: PackedSkill[] = [
      {
         name: 'product-discovery',
         description: 'Use for a new product idea.',
         content: '# Product discovery\n',
         labels: ['Product Lead'],
         source: 'seed://berry-software-skills',
      },
   ];

   before(async () => {
      sql = openDatabase({ url: url! });
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`autoseed-${suffix}@berry.test`}, 'Autoseed test')
         RETURNING id`;
      userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name, created_by, discovery_enabled)
         VALUES (${randomUUID()}, ${`auto-${suffix}`}, 'Autoseed org', ${userId}, true)
         RETURNING id`;
      workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${workspaceId}, ${userId}, 'owner')`;
      const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${workspaceId}`;
      boardId = board!.id as string;
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM autopilot_runs WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilot_triggers WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilots WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM agent_skills WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM skills WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM skill_labels WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM issues WHERE board_id = ${boardId}`;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDatabase(sql);
   });

   test('a new workspace gets role agents and pack skills, and no autopilots', async () => {
      const steps: string[] = [];
      await autoseedWorkspace(sql, workspaceId, {
         skills: pack,
         syncRuntime: async () => {
            steps.push('runtime');
            throw new Error('runtime unavailable');
         },
         onError: (step) => steps.push(`error:${step}`),
      });

      // Runtime failure is logged and does not block skills.
      assert.deepEqual(steps, ['runtime', 'error:runtime']);

      const [agents] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM agents
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND role_key IS NOT NULL`;
      assert.equal(agents!.n, CORE_ROLES.length, 'the Orchestrator only');

      const [skills] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM skills WHERE workspace_id = ${workspaceId} AND name = 'product-discovery'`;
      assert.equal(skills!.n, 1);

      // The pack skill waits for its role: adding the Product Lead binds it.
      const bound = async () =>
         (
            await sql<Array<{ n: number }>>`
               SELECT count(*)::int AS n FROM agent_skills AS binding
                 JOIN skills AS skill ON skill.id = binding.skill_id
                WHERE binding.workspace_id = ${workspaceId} AND skill.name = 'product-discovery'`
         )[0]!.n;
      assert.equal(await bound(), 0);
      await addRole(sql, workspaceId, 'product-lead');
      await bindRolePackSkills(sql, workspaceId);
      assert.equal(await bound(), 1, 'pack skill is bound to the matching role once it is added');

      // Weekly discovery is switched on by a person, even where the flag is
      // already on: nothing seeds its autopilots.
      await autoseedWorkspace(sql, workspaceId, { skills: pack });
      const [autopilots] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM autopilots WHERE workspace_id = ${workspaceId}`;
      assert.equal(autopilots!.n, 0);
   });

   test('the skill label catalogue holds every label the seeded skills carry, and keeps a retired one retired', async () => {
      await autoseedWorkspace(sql, workspaceId, { skills: pack });
      const active = async () =>
         (
            await sql<Array<{ name: string; color: string }>>`
               SELECT name, color FROM skill_labels
                WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
                ORDER BY name`
         ).map((row) => row.name);
      const carried = await sql<Array<{ label: string }>>`
         SELECT DISTINCT label FROM skills, unnest(labels) AS label
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
          ORDER BY label`;
      assert.ok(carried.some((row) => row.label === 'Product Lead'));
      assert.deepEqual(await active(), carried.map((row) => row.label));

      const [colored] = await sql<Array<{ ok: boolean }>>`
         SELECT color = berry_skill_label_color(name) AS ok FROM skill_labels
          WHERE workspace_id = ${workspaceId} AND name = 'Product Lead'`;
      assert.equal(colored?.ok, true);

      await sql`
         UPDATE skill_labels SET archived_at = now()
          WHERE workspace_id = ${workspaceId} AND name = 'Product Lead'`;
      const again = await seedWorkspaceDefaults(sql, workspaceId, pack);
      assert.equal(again.skillLabels, 0);
      assert.equal((await active()).includes('Product Lead'), false);
      const [rows] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM skill_labels
          WHERE workspace_id = ${workspaceId} AND lower(name) = 'product lead'`;
      assert.equal(rows?.n, 1);
   });

   // Per role agent: how many enabled skills, and how many not labelled for its role.
   const bindingsByRole = async () =>
      sql<Array<{ role_key: string; name: string; bound: number; foreign: number }>>`
         SELECT agent.role_key, agent.name,
                count(binding.skill_id) FILTER (WHERE binding.enabled)::int AS bound,
                count(binding.skill_id) FILTER (WHERE NOT (agent.name = ANY (skill.labels)))::int AS foreign
           FROM agents AS agent
           LEFT JOIN agent_skills AS binding ON binding.agent_id = agent.id
           LEFT JOIN skills AS skill ON skill.id = binding.skill_id
          WHERE agent.workspace_id = ${workspaceId} AND agent.archived_at IS NULL AND agent.role_key IS NOT NULL
          GROUP BY agent.role_key, agent.name
          ORDER BY agent.role_key`;

   test('every role agent is bound to exactly its own eight pack skills', async () => {
      const full = loadPackedSkills();
      // A core role and a specialist it stands in for: the core role keeps its own eight.
      await addRole(sql, workspaceId, 'software-engineer');
      await addRole(sql, workspaceId, 'backend-engineer');
      await addRole(sql, workspaceId, 'bookkeeper');
      await seedWorkspaceDefaults(sql, workspaceId, full);
      const rows = await bindingsByRole();
      assert.ok(rows.some((row) => row.role_key === 'backend-engineer'));
      for (const row of rows) {
         assert.equal(row.bound, SKILLS_PER_ROLE, `${row.name} is bound to ${row.bound} skills`);
         assert.equal(row.foreign, 0, `${row.name} carries another role's skills`);
      }
   });

   test('migration 248 drops inherited and capability bindings, and keeps a role agent its own', async () => {
      const [engineer] = await sql<Array<{ id: string }>>`
         SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND role_key = 'software-engineer' AND archived_at IS NULL`;
      assert.ok(engineer);
      const legacy = [
         { name: 'legacy-backend-skill', labels: ['Backend Engineer'], source: 'seed://berry-agentcore-deep-skills-100' },
         { name: 'frontend', labels: ['Software Engineer'], source: 'seed://role-capability' },
         { name: 'hand-made-skill', labels: ['Backend Engineer'], source: null },
      ];
      for (const skill of legacy) {
         const [row] = await sql<Array<{ id: string }>>`
            INSERT INTO skills (workspace_id, name, description, content, labels, source_kind, source_url, created_at, updated_at)
            VALUES (${workspaceId}, ${skill.name}, 'Legacy.', '# Legacy\n', ${skill.labels}, 'manual', ${skill.source}, now(), now())
            RETURNING id`;
         await sql`
            INSERT INTO agent_skills (agent_id, skill_id, workspace_id, enabled)
            VALUES (${engineer.id}, ${row!.id}, ${workspaceId}, true)`;
      }
      await sql.unsafe(readFileSync(MIGRATION_248, 'utf8'));
      const left = await sql<Array<{ name: string }>>`
         SELECT skill.name FROM agent_skills AS binding JOIN skills AS skill ON skill.id = binding.skill_id
          WHERE binding.agent_id = ${engineer.id}`;
      const names = left.map((row) => row.name);
      assert.ok(!names.includes('legacy-backend-skill'), 'inherited specialist skill is unbound');
      assert.ok(!names.includes('frontend'), 'capability skill is unbound');
      assert.ok(names.includes('hand-made-skill'), 'a person\'s own skill stays bound');
      assert.equal(names.filter((name) => name !== 'hand-made-skill').length, SKILLS_PER_ROLE);
   });
});
