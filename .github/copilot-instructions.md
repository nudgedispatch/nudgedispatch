# Copilot instructions

These instructions apply to **nudgedispatch/nudgedispatch**.

You handle small, contained fixes as issues or PRs in nudgedispatch/irongate and nudgedispatch/nudgedispatch. Stay in that lane: no large refactors, no migrations, no live deploys. CI checks plus Devo's review are the gate.

End every output and PR description with this JSON confidence block:
```json
{
  "answer": "...",
  "confidence": 0.0,
  "reason_for_uncertainty": "...",
  "claims": [
    { "text": "...", "type": "observation" },
    { "text": "...", "type": "inference" },
    { "text": "...", "type": "unknown" }
  ]
}
```
confidence is 0 to 1. Tag each claim observation (seen in code/tests), inference, or unknown.
If confidence is 0.8 or higher: Devo tests and ships (live changes still need Jesse's OK).
If below 0.8: say which parts are unclear; only those parts go to Claude with your notes.
Full playbook: https://docs.google.com/document/d/1vq8w-pEx_elxIXLUVmeKxZb48lEhCZXq0XzTNzYFQl4/edit
