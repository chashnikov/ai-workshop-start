#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored.
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { run } from './commands.ts';
import { AtlasError } from './core/errors.ts';
import { openGitHub, parseGitHubUrl, scanOrganization } from './core/github.ts';
import { openDirectory } from './local.ts';
import { createWebServer } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;

process.exitCode = await run(process.argv.slice(2), {
  open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input)),
  organization: (input) => scanOrganization(input, { fetch, token }),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // GitHub only: a page must not read this machine's directories. On this machine only, too.
  async serve(port) {
    const server = createWebServer({
      open: (input) => openGitHub(input, { fetch, token }),
      organization: (input) => scanOrganization(input, { fetch, token }),
    });
    server.listen(port, '127.0.0.1');
    try {
      await once(server, 'listening'); // rejects with the server's error
    } catch (error) {
      throw new AtlasError(`Cannot start the web view on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  },
});
