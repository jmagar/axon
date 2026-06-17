# Aurora Primitive Convergence Closeout

Date: 2026-06-17
Epic: `axon_rust-hrqn`

## Sequence

- `axon_rust-hrqn.1` completed first: `docs/reference/aurora-primitive-inventory.json` plus `scripts/check_aurora_primitive_inventory.py`.
- `axon_rust-hrqn.2` completed in Aurora web branch `codex/axon-hrqn-web-primitives` at `432f321ba190920e2d9f2a8e903de848db76a854`.
- `axon_rust-hrqn.4` completed in Aurora Android branch `codex/axon-hrqn-android-primitives` at `6ff68d156bef886c6daa6194f793c5d1520cec2b`.
- `axon_rust-hrqn.3` completed in Axon branch `codex/axon-hrqn-web-migrate` at `292a0d4b`, then merged into this feature branch.
- `axon_rust-hrqn.5` completed in Axon branch `codex/axon-hrqn-android-migrate` at `60fbce92c6d2093d6bc39f457077118d0ce9ad3f`, then merged into this feature branch.

## Verification

Axon static guard:

- `just primitive-inventory-check`
- Result: passed. The guard validates the machine-readable inventory and fails on unclassified web raw controls or Android reusable-control smells.

Axon web palette:

- `pnpm test -- SettingsFields OperationResultView App SettingsPanel`
- Result: passed, 24 files and 227 tests.
- `pnpm typecheck`
- Result: passed.
- `pnpm vite:build`
- Result: passed.

Axon Android:

- `./gradlew -PaxonAuroraAndroidPath=/home/jmagar/workspace/aurora-design-system/.worktrees/codex/axon-hrqn-android-primitives/android :app:testDebugUnitTest --no-daemon`
- Result: passed. Output included included-build `:android:aurora:*` tasks, proving active sibling Aurora composite resolution.
- `./gradlew -PaxonAuroraAndroidPath=/home/jmagar/workspace/aurora-design-system/.worktrees/codex/axon-hrqn-android-primitives/android :app:compileDebugAndroidTestKotlin --no-daemon`
- Result: passed. Output included included-build `:android:aurora:*` tasks.

Aurora web:

- `pnpm registry:build`
- Result: passed and rebuilt registry artifacts.
- `pnpm test:unit`
- Result: passed, 43 tests. Coverage includes NativeSelect, ScrollArea compatibility, dot-only StatusIndicator, and Button disabled/loading `asChild` artifact guards.

Aurora Android:

- `cd android && ./gradlew :aurora:compileDebugKotlin --no-daemon`
- Result: passed.
- `cd android && ./gradlew :aurora:testDebugUnitTest --no-daemon`
- Result: passed.

Repository hygiene:

- `git diff --check HEAD~5..HEAD`
- Result: passed.

## Surface Outcomes

- `W-PAL-001`: idle tray now routes through Aurora Button while staying an Axon shell composite.
- `W-PAL-002`: settings lists use Aurora NativeSelect with unset-option semantics preserved.
- `W-PAL-003`: settings wrappers remain local Axon composites over Aurora Input/Button; secret protections remain covered by tests.
- `W-PAL-004`: ScrollArea compatibility is documented upstream and the local fork scope is no longer a broad primitive sync task.
- `W-PAL-005`: status dots use the Aurora StatusIndicator dot-only API.
- `A-AND-001`: repeated BasicTextField shells migrated to Aurora text/prompt primitives where reusable.
- `A-AND-002`: app-local icon/action buttons migrated to AuroraIconButton or Aurora Button surfaces.
- `A-AND-003`: tabs/chips/switch rows moved onto Aurora reusable control surfaces.
- `A-AND-004`: status/progress surfaces moved onto Aurora status/progress APIs with static or opt-in animation behavior.
- `A-AND-005`: Axon brand and shell orchestration stayed local, while generic row affordances use Aurora navigation/sidebar APIs.

## Stale Split-Brain Beads

- `axon_rust-q0io`: close as superseded by `W-PAL-003` and `S-STL-001`; old input/kbd scope is complete except settings composites that are now explicitly classified and guarded.
- `axon_rust-496l`: close as superseded by `W-PAL-001` and `S-STL-002`; the remaining raw web button was converted to Aurora Button.
- `axon_rust-5z77`: close as superseded/narrowed by `W-PAL-004` and `S-STL-003`; broad primitive resync should not be revived.
- `axon_rust-dnu7`: close as verified by `S-STL-004`; Aurora web tests and generated artifact checks cover Button disabled/loading `asChild` behavior.

## Deferred Checks

- Representative screenshots were not captured in this pass. The changed web surfaces have targeted role/semantics tests and production build coverage; Android surfaces have Compose semantics/unit coverage. A browser/device screenshot sweep can be run as a release-confidence pass if visual review is required before merge.
- Android device smoke was not run. The final Android validation used JVM/Compose tests and compile checks against the active sibling Aurora composite; no emulator/device was attached in this closeout pass.
