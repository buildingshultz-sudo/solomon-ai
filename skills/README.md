# Solomon Skills Library

This directory contains Solomon's learned skills — reusable playbooks for recurring workflows.

## Structure

Each skill is a folder containing:
- `metadata.yaml` — name, description, trigger conditions, version
- `instructions.md` — step-by-step playbook (under 5k tokens)
- Optional scripts (Python/Bash) for deterministic execution

## How Skills Work

1. Solomon checks this directory before responding to any task request
2. If a matching skill is found, Solomon follows its instructions exactly
3. When Jed says "make this a skill", Solomon creates a new folder here
4. When Jed corrects Solomon on a skilled task, the skill is updated

## Creating Skills

Tell Solomon: "Make this a skill" or "Save that as a skill" or "Remember this workflow"

## Available Skills

(None yet — skills will appear here as they are created)
