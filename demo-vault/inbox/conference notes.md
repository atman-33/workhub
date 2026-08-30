Notes from the perf talk:

- sampling profilers now cheap enough to leave on in dev builds
- layout thrash is usually a read-after-write in an effect
- they measured input latency, not frame time — different story

Try the profiler on our editor. (Parked as T-0011.)
