---
name: hello
description: Phase 1 probe skill. When the user says ping the electronics platform, load this skill and call hello_ping.
user-invocable: true
---

# Hello

1. Call tool `hello_ping` with the token from the user. If they did not give a token, use `phase1`.
2. Return the tool JSON unchanged. Do not invent fields.
