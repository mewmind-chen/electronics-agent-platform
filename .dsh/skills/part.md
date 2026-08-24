---
name: part
description: Electronics part research. Use when analyzing an MPN market. Call part_research. Never write a business database.
user-invocable: true
---

# Part Intelligence

1. Call `part_research` with the exact MPN. Do not truncate suffixes.
2. Return the tool JSON. Every claim must keep its evidenceId.
3. Do not INSERT / report.save / write Radar or Workbench databases.
4. If evidence is thin, keep verdict.state = 未知.
