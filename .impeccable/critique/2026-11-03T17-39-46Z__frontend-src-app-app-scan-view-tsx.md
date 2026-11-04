---
target: /scan
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/tayef/code/rental.manegments/frontend/src/app/(app)/scan/view.tsx"
target_fingerprint: "sha256:76aba5f17b310a9801607ffd1ea5dfb34d3e4f309f4575080e4037e9fe8c3ccb"
target_path: /home/tayef/code/rental.manegments/frontend/src/app/(app)/scan/view.tsx
timestamp: 2026-11-03T17-39-46Z
slug: frontend-src-app-app-scan-view-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | A second scan swaps the result card silently — no aria-live, no visual beat, no haptic |
| 2 | Match System / Real World | 3 | "Take one back" contradicts partial returns; sixty of a hundred come back, not one |
| 3 | User Control and Freedom | 2 | No scan history, no undo, no way back to the previous code; switching tabs destroys typed input |
| 4 | Consistency and Standards | 2 | Breaks two of its own named rules: three filled Ink Blue buttons at once, and amber on the not-found icon |
| 5 | Error Prevention | 1 | The header "Rent out" sits 100px above "Rent this out", looks identical, and silently discards the scan |
| 6 | Recognition Rather Than Recall | 3 | By-name rows carry name + SKU only — no stock, no price — in the exact case recall is hardest |
| 7 | Flexibility and Efficiency | 2 | Excellent gun ergonomics, available on one of three tabs; no keyboard route to the suggestions |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained and the answer lands in a fixed slot; ~55% of the desktop viewport is dead |
| 9 | Error Recovery | 1 | The diagnosis is frequently wrong, and the recovery button breaks the scanner |
| 10 | Help and Documentation | 2 | "A USB scanner works here too" is good inline help; nothing covers why a good label won't scan |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict

**Authored in the details, borrowed in the structure — and the borrowed structure costs the product its primary input device.**

Two things are unmistakably built for a rental counter. `CodeInput` is never disabled during a lookup (disabling blurs the field, and a gun typing into nothing is a silently lost item), clears and re-focuses on submit, and is 44px tall with mono figures and every mobile keyboard correction switched off. The `Found` card's right-hand "863 / on the shelf" block with "Deposit ৳500.00 each" is shop vocabulary, not CRUD vocabulary.

Everything holding them together is a stock shadcn admin page: PageHeader, two header buttons, a 3-up tab strip, a result card, a 3-up stat row. Relabel "on the shelf" as "in stock" and this composition serves an asset-tracking SaaS or a library checkout tool unchanged.

That would be forgivable if the generic chassis were neutral. It is not. The tab metaphor breaks the product's hardest requirement: Radix unmounts inactive panels, so on two of the three tabs the barcode gun has no field to type into. `ScanField`, in the same file, already solves this correctly — field always present, camera as a sibling toggle — and this screen declines to use it.

**Deterministic scan:** clean on both channels. CLI detector returned `[]` (exit 0) over `scan/view.tsx` and `scanner.tsx`. The runtime overlay, injected into a live page, reported "No anti-patterns found". Zero console errors or warnings on load. The detector and the design review disagree completely, and both are right: the implementation is clean, the composition is not.

**Visual overlays:** the overlay ran in an isolated tab that has since been closed, so there is no live overlay in your browser now. Its console output was the single clean result above.

## Overall Impression

This screen was built by someone who understood the hardware and then wrapped it in a layout that fights it. The scanning component is the best-reasoned code in the project. The page around it treats three input methods as equals when one is used 95% of the time, and the equality is not cosmetic — it unmounts the dominant one. The biggest opportunity is structural and already written: adopt `ScanField`, make the code field permanent, and demote camera and name-search to what they are, fallbacks.

## What's Working

1. **`CodeInput` is expert hardware ergonomics.** Never disabled during a lookup, explicit re-focus on submit, `autoComplete`/`autoCapitalize`/`spellCheck` off, mono, 44px. The comments explain the reasoning, and the reasoning is right.
2. **The answer always lands in the same place.** Mounting the camera only while its tab is open means the result slot under the tabs is a fixed address — scan, look down, read — and the device camera is released the instant you leave.
3. **The camera failure copy is excellent.** Three branches (permission denied, no device, generic) and every one ends with a route back to work. This is the standard the lookup failure should be held to.

## Priority Issues

### [P1] A network or server failure is reported as "this product does not exist"
**Why it matters.** `useLookup` sets `retry: false` and the view collapses every `isError` into the not-found copy, so a 404 and a dropped connection render identically. Reproduced twice independently: with fetch failing, a real seeded product was reported as unknown, in bold, with a status-coloured icon. During an outage every item in the shop vanishes one confident card at a time, and the documented recovery — search by name — hits the same dead server. DESIGN.md explicitly requires `ErrorState` with a retry rather than empty-state copy.
**Fix.** Branch on the failure. 404 keeps the current card; anything else gets "Couldn't reach the server — the item may well exist" and a Try again button wired to `refetch()`. Allow one silent retry on network errors.
**Suggested command:** /impeccable harden

### [P1] The barcode gun has no target on two of the three tabs
**Why it matters.** Verified live: the code field is absent from the DOM on the Camera tab and on the By-name tab, and the name input is not inside a form, so the gun's trailing Enter does nothing at all. A staffer who left the screen on Camera pulls the trigger and gets silence — no error, no clue. The natural read is "the gun is broken" or "the item isn't in the system". PRODUCT.md names the gun as primary counter hardware and requires a persistent focus target.
**Fix.** Use `ScanField` from the same file: code field permanently on screen, camera as a toggle beside it, name-search demoted to a disclosure below. If the tabs must stay, keep an always-mounted hidden scan field that claims gun input on any tab.
**Suggested command:** /impeccable harden

### [P1] Two controls silently sabotage the scan
**Why it matters.** Both verified. (a) "Scan something else" unmounts the card that contains it, dropping focus to `BODY` — the next gun trigger types into nothing, which is the exact failure `scanner.tsx` warns about in a comment. (b) After a successful scan the header "Rent out" sits ~100px above the card's "Rent this out", in the same fill and colour, differing by one word — and it drops the scanned code, landing the staffer in an empty form.
**Fix.** (a) Clear and refocus in one handler, or delete the button since the field is already clear. (b) Demote the header actions to `variant="outline"`, or hide them while a product is found.
**Suggested command:** /impeccable harden

### [P2] Nothing is announced, and nothing is confirmed non-visually
**Why it matters.** The only live region is an empty toaster. Neither the loading line, the found card, nor the failure is announced, so a screen-reader user presses Enter into silence. A sighted staffer scanning twenty items with eyes on the stock has no beat, no haptic and no list to confirm item fourteen registered — and a missed item is a charge to the wrong person.
**Fix.** Wrap the result slot in `role="status" aria-live="polite" aria-atomic="true"`. Add a short vibration on resolve and a different pattern on failure. Give the card a one-frame highlight when its content swaps.
**Suggested command:** /impeccable harden

### [P2] The found card withholds the numbers the decision needs
**Why it matters.** It shows per-day, per-week and deposit prices plus a raw count, but never flags low stock — 5 units against a threshold of 2 renders in identical ink to 863 — and never shows the code that was actually scanned, so if barcode and SKU differ there is no confirmation that the thing on screen is the thing in your hand. The system owns an amber for low stock and spends it instead on the not-found icon, where DESIGN.md forbids it.
**Fix.** Tint the on-hand figure with the Due amber below the threshold and add "5 left — 3 out on rent". Echo the scanned code on the card. Put stock and rate into each By-name row.
**Suggested command:** /impeccable clarify

## Persona Red Flags

**Alex (power user, keyboard only).** No shortcut to any tab. The eight suggestions are plain buttons in a `<ul>` with no combobox semantics — no arrow traversal, no Enter-to-pick-first, so reaching the fourth result costs four Tabs. No scan history to reopen the item from thirty seconds ago. The header "Rent out" is where a fast hand goes after a scan, and it throws the scan away.

**Sam (accessibility-dependent).** The page is mute: no announcement on loading, found, or not found. The failure card's only useful control, "open the products list", measures 15px tall and is styled in muted grey rather than Ink Blue, so it reads as neither a target nor a link. `autoFocus` on both the code field and the name field means focus jumps on mount and on every tab change with no announcement of where it went.

**The counter staffer, mid-queue, gun in hand, customer waiting.** Gun fires, nothing happens — the screen was left on Camera. Gun fires, card says the barcode doesn't exist — the wifi blipped, and they walk to the shelf to check a label that was never wrong. They tap "Scan something else", focus lands on body, and the next three triggers register nowhere. They tap the big blue "Rent out" because it is the biggest blue thing and the word matches the job, and re-key the barcode by hand. They need to take back sixty of a hundred units; the button says "Take one back".

## Minor Observations

- `/scan` uses `max-w-3xl` while the rest of the app uses `max-w-6xl` — defensible for a single-task surface, but undocumented, and it leaves roughly half the desktop viewport empty below the stat tiles.
- The three stat tiles are the owner's dashboard pasted under the staffer's task, occupying the peak-end position the completed action should hold.
- "Type or" hides below `sm`, so the first tab reads just "scan" on a phone — the one label telling a phone user they can type disappears exactly where typing is hardest.
- The `Found` header uses explicit grid placement for the on-hand block; a long name plus category plus a "Not for rent" badge will collide before it wraps.
- `suggestions.slice(0, 8)` truncates silently — search "machine", get eight, learn nothing about the other four.
- The not-found card ends with a full stop stranded outside the link underline.
- The 2500ms duplicate-suppression window is tuned for adding items; on a lookup screen, deliberately re-scanning to re-read a count appears to do nothing for 2.5s.
- Sidebar nav items measure 32px against the system's own stated 36px finger-target floor.

## Questions to Consider

1. If the gun is the dominant input at the counter, why does it get one-third of a tab strip instead of the whole screen? `ScanField` is already that design, in the same file. Is the argument for not using it here older than PRODUCT.md?
2. What is this screen's answer to "I scanned the label and it says the product doesn't exist"? Right now it is a dead end with a 15px link, and roughly half the time the statement is false. Should the card offer "Attach this code to a product" — turning the worst moment into the place a mislabelled item gets fixed by the person holding it?
3. Who are the three stat tiles for? If the honest answer is "to stop the page looking empty", that is a layout problem, and a recent-scans list would serve the person scanning twenty items in a row.
