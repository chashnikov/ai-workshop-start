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
  organization: (input, progress) => scanOrganization(input, { fetch, token, progress }),
  // On a terminal only: in a file or a pipe, the lines would only get in the way.
  progress: process.stderr.isTTY ? (text) => process.stderr.write(`\r\x1b[K${text}`) : undefined,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // GitHub only: a page must not read this machine's directories. On this machine only, too.
  async serve(port) {
    const server = createWebServer({
      open: (input) => openGitHub(input, { fetch, token }),
      // Read when the page asks (the organization's page): choosing a repository then shows its skills at once.
      organization: (input, { read, progress } = {}) => scanOrganization(input, { fetch, token, read, progress }),
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
