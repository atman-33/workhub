---
name: setup-openspec
description: Install OpenSpec CLI (if not already installed) and run openspec init --tools claude to add spec-driven development skills to this project.
disable-model-invocation: true
allowed-tools: Bash(node --version) Bash(npm list *) Bash(npm install *) Bash(openspec *)
---

Set up [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development in this project.

Steps:

1. Verify Node.js ≥ 20.19.0 is available. Run `node --version`. If Node is missing or older than 20.19.0, stop and tell the user to upgrade Node.js first.

2. Check whether the OpenSpec CLI is already installed globally:
   ```bash
   npm list -g @fission-ai/openspec --depth=0
   ```
   If it is not installed (command exits non-zero or output does not mention `@fission-ai/openspec`), install it:
   ```bash
   npm install -g @fission-ai/openspec@latest
   ```

3. Run OpenSpec initialization in the current project directory:
   ```bash
   openspec init --tools claude
   ```

4. Report what was done:
   - Whether openspec was already installed or newly installed
   - The output of `openspec init --tools claude`
   - The skills and commands that are now available (`/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:archive`)
