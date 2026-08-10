# Debug Session: queue-progress-bar
- **Status**: [OPEN]
- **Issue**: Queue page shows the numeric percentage, but the visual progress bar does not appear or render correctly on first load.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-queue-progress-bar.ndjson

## Reproduction Steps
1. Start a download so queue progress is active.
2. Open the Queue page.
3. Observe that the percentage text updates, but the filling progress bar is missing or not visible.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Queue data reaches the page, but the fill width is not applied on first render. | High | Low | Rejected: queue data and inline fill width are present in logs. |
| B | The queue card layout computes before the page is fully visible, so the bar track ends up with zero usable width until a later repaint. | High | Low | Confirmed: `.queue-progress-bar` repeatedly measured `0px` width while fill existed. |
| C | Another CSS rule on the Queue page is still overriding the progress bar/fill after initial render. | Medium | Low | Inconclusive: CSS contributes to layout fragility, but evidence points more directly to zero-width layout. |
| D | The initial queue render path differs from later polling updates, so only the percent text gets refreshed reliably. | Medium | Medium | Partially confirmed: later updates changed fill width, but the track still stayed `0px` wide. |

## Log Evidence
- `static/queue.js:updateQueue`: queue API returned `count: 1` with progress values, so data reached the page.
- `static/queue.js:displayQueue:rebuild`: card, bar, and fill all existed, but `barOffsetWidth: 0` and `barClientWidth: 0`.
- `static/queue.js:displayQueue:update`: later updates showed `inlineWidth` changing and `fillOffsetWidth: 10`, while `barOffsetWidth` stayed `0`.

## Verification Conclusion
- Root cause: the queue progress track rendered with zero width on page load and during subsequent updates, so the percentage text updated but the visible bar never appeared.
- Fix in progress: force one extra queue refresh on entry and explicitly stabilize queue progress layout after render/update.
