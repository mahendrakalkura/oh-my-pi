// Ambient config overlays must not reach the test suite. A session launched by
// `omp` exports `PI_CONFIG_FILES` pointing at the user's own config overlay,
// and the Settings constructor reads that variable before any `inMemory` or
// `readOnly` branch (packages/coding-agent/src/config/settings.ts), so every
// test that initializes settings inherits the developer's preferences. A
// `startup.quiet: true` overlay, for example, suppresses the welcome panel and
// fails eight welcome-dependent cases in startup-composer,
// issue-9597-cold-launch-double-clear and interactive-terminal-e2e.
//
// Tests that exercise the overlay mechanism pass the variable explicitly into a
// spawned child (see test/config-cli.test.ts), so clearing the ambient value
// here leaves them intact.
delete process.env.PI_CONFIG_FILES;
