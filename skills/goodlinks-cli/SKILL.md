---
name: goodlinks-cli
description: Use the GoodLinks CLI to operate a local GoodLinks library. Use this skill whenever the user wants reading, searching, adding, editing, tagging, cleaning, duplicate or dead-link review, reporting, exporting, or visualizing through the goodlinks command, even when they do not explicitly ask for a skill.
---

# GoodLinks CLI

1. Check whether `goodlinks` is available.
2. If it is unavailable, explain how to install `@berrydev-ai/goodlinks-cli` and wait for permission before installing anything.
3. Before operating the CLI, run:

   ```sh
   goodlinks skills get core
   ```

4. Follow the returned version-matched instructions.
5. If `core` cannot be found, run `goodlinks skills list` and report the package-integrity problem.
