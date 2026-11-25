# engine

Python container ("engine") for PDF parsing and portfolio builds: FastAPI with `/parse`, `/build`, `/stocks/scrape`
and `/health`. It's reached only through the Worker's `EnginePool` Durable Object.

Built in milestone **M1** ([docs/MILESTONES.md](../docs/MILESTONES.md)). Design: plan §14.

- Real statements for local tests go in `tests/private/`, which is git-ignored. Tests print counts only.
- Until M10, the original app in `/app` stays the reference implementation.
