#!/usr/bin/env node
import { parseCommand } from './command.js';

const endpoint = process.env.PUBLISHING_ENDPOINT;
const token = process.env.PUBLISHING_ADMIN_TOKEN;
if (!endpoint || !token) {
  throw new Error('PUBLISHING_ENDPOINT and PUBLISHING_ADMIN_TOKEN are required');
}

const command = parseCommand(process.argv.slice(2));
const response = await fetch(new URL(command.path, endpoint), {
  method: command.method,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(command.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(command.method === 'POST' ? { body: JSON.stringify(command.body) } : {}),
});
const output: unknown = await response.json();
process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
if (!response.ok) process.exitCode = 1;
