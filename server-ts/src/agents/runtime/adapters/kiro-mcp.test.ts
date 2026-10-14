import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBerryMcpTool } from './kiro-mcp.ts';

test('Kiro may call a Berry tool by its @berry/ name', () => {
   const tools = [{ name: 'list_run_tools' }, { name: 'run_command' }];
   assert.equal(resolveBerryMcpTool(tools, '@berry/list_run_tools')?.name, 'list_run_tools');
   assert.equal(resolveBerryMcpTool(tools, 'list_run_tools')?.name, 'list_run_tools');
   assert.equal(resolveBerryMcpTool(tools, 'mcp__berry__run_command')?.name, 'run_command');
   assert.equal(resolveBerryMcpTool(tools, 'other/list_run_tools'), undefined);
});
