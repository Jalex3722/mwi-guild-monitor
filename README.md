# MWI Guild Monitor

MWI Guild Monitor is a private, read-only Tampermonkey userscript for guild leaders and officers in [Milky Way Idle](https://www.milkywayidle.com/). It watches data that the game already sends to the current browser tab and builds a local guild dashboard.

It never sends gameplay commands. Its only additional request is a cached read-only GET to the game's official market-price feed.

## Features

- Guild roster with role, online state, guild XP, and weekly XP when supplied by the game
- Member activity, 3-day offline warnings, strongest captured skill, profile freshness, and current trial choices
- Average, median, minimum, and maximum level for every captured skill
- Visible highest-level member names and counts above levels 100, 125, and 150
- Current-week warnings when a member above level 125 did not join that skill's trial
- Explicit profile coverage so partial averages cannot be mistaken for full-guild results
- Missing-profile checklist
- Locally cached member profiles and capture age
- Manual snapshots with average-level change comparison
- Weekly skilling and combat trial signup counts
- Previous-week signup tracking, with an unsigned status recorded only when neither trial category was joined
- Per-trial signup levels, level ranges, minimum requirements, and member rosters
- Combat role distribution for each combat trial
- Manual desired-aura assignments for guild members
- Per-combat-trial aura coverage, missing-aura, and duplicate-aura warnings
- Aura-player tracking for unsigned and incorrectly grouped designated players
- Globally optimized, balanced skilling-trial allocations based on captured member levels and guild medians
- First and second weekly trial choices ranked by each member's level relative to the captured guild median
- Cheapest market-priced material conversion for every guild credit type
- Incremental and cumulative coin estimates for every guild shrine level
- CSV export for Excel or Google Sheets, including guild XP, offline duration, prior-week status, trial signups, and aura assignments
- Local-only storage in the current browser

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Open the [raw userscript](https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js).
3. Confirm the installation in Tampermonkey.
4. Reload Milky Way Idle.
5. Select the **GM** button at the lower-right corner of the game.

The script includes `@updateURL` and `@downloadURL` metadata. Tampermonkey will detect a pushed release when its `@version` is newer than the installed version. You can also trigger **Check for userscript updates** from the Tampermonkey dashboard.

The monitor header displays its running version. The current release is `v0.8.4`.

## Collecting member skill data

The game sends the guild roster automatically, but it does not include every member's full skill list in that roster. Full skills arrive when the game displays a profile.

1. Open Milky Way Idle's **Guild > Members** panel.
2. Open each member's **Profile** normally.
3. The userscript passively captures the `profile_shared` response and caches it.
4. Check **GM > Missing profiles** until coverage reaches 100%.

This is intentionally manual. Automatically requesting every profile would send actions to the game server and would conflict with the game's extension rules.

## Reading the dashboard

The skill table shows both the arithmetic mean and median of captured members' displayed levels. `Min` and `Max` are the lowest and highest displayed level for that skill. The max-level member names are shown directly, and the threshold columns count levels strictly greater than 100, 125, and 150. Hover over a count to see its members and levels.

For a skill offered in the current weekly trials, `>125 not in trial` lists captured members above level 125 who chose another skilling trial or no skilling trial. This is deliberately separate from the general participation warning, which only lists members who joined neither a skilling nor a combat trial.

`Coverage` is the number of current roster members with a cached profile divided by the roster size. Statistics with less than 100% coverage are valid only for the captured subset.

Select **Snapshot** to save the current aggregate locally. The `Change` column compares the current average with the latest saved snapshot. Because profiles are captured at different times, treat snapshots as operational estimates rather than synchronized leaderboard records.

The **Members** tab places each captured member's first and second median-fit trial choices beside their name. It also flags a player after a known offline duration reaches 72 hours. A hidden online status or unavailable timestamp is shown separately and is never treated as a 3-day absence.

## Guild trials

The **Trials** tab reads the current weekly trial set and the signup information already sent to the game. It shows:

- How many members signed up for skilling and combat trials
- Which members signed up for neither skilling nor combat; category-specific absence is not treated as a general participation warning
- Signup-time skill or combat levels
- Guild-configured minimum level requirements
- Combat role counts for each combat trial
- Actual skilling signups alongside an optimized target distribution, including members currently signed elsewhere or not signed up

The optimizer assigns each captured member with at least one eligible skill to one skilling trial, respects guild minimum levels, and keeps target roster sizes within one member when possible. It tests every feasible balanced size pattern and finds the assignment maximizing the sum of per-trial averages of `member level - captured guild median`. When every trial has a target roster, subtracting medians is a constant offset, so this also maximizes the sum of raw trial average levels. If minimum levels make balanced rosters infeasible, the script shows a best-fit fallback and labels it as such. **Different signup** means the member's current skilling trial differs from that target; it does not mean their current choice is necessarily wrong.

The Trials tab displays actual signup rosters and signup-time levels when available, then compares actual and optimized rosters using captured profile levels for both averages. Actual averages show how many signed members have captured profiles. Players without captured profiles cannot be optimized; check **Missing profiles** before using the plan for decisions. Signup slot caps, equipment, buffs, and availability are not modeled.

Names in the optimized target roster are green when signed for that skilling trial, yellow when signed for another skilling trial or for combat only, and red when signed for neither trial category. Each name also has a colored dot and a tooltip describing its current signup. The member assignments list uses the same markers, and its status column uses the same colors.

If the Trials tab reports zero captured profiles, the actual signups remain visible but no optimized target or name colors can be calculated. Open member profiles in the game while the script is enabled, then return to Trials. The missing-profiles button in the empty target state lists who still needs to be viewed.

The first and second choices beside each name use `member level - captured guild median`. They highlight where a member is strongest relative to the guild, but do not model attendance, equipment, consumables, or roster quotas.

Combat recommendations are not generated. Combat level alone cannot account for equipment, abilities, consumables, roles, or encounter mechanics, so the dashboard reports combat roster and role coverage without presenting a misleading “best” encounter.

The script keeps a rolling local ledger of the latest signup state it observed for each guild week. In the following week, **No signup** means the member was still unsigned in both categories when observed during the final 24 hours of the prior week. **Signed** means either signup was observed. **Unknown** means the member was not observed late enough to establish an unsigned status, or that week was not observed at all. The monitor records signup state, not actual trial attendance.

## Aura planning

Open the **Auras** tab to assign one desired aura to each designated guild member. The available choices match the current combat aura set:

- Speed Aura, scaling with Attack
- Guardian Aura, scaling with Defense
- Fierce Aura, scaling with Melee
- Critical Aura, scaling with Ranged
- Mystic Aura, scaling with Magic

The assignment table shows the member's captured scaling-skill level and current combat-trial signup. The Trials tab then evaluates each combat roster independently. An aura is **covered** when exactly one designated player is signed up for that trial, **missing** when nobody is designated, and **duplicate** when two or more designated players for that aura are in the same trial.

Aura assignments are manual planning labels. The script does not inspect equipped trial loadouts, equip abilities, or change signups. Assignments are saved per guild in the same local browser storage as captured profiles.

## Shrine economics

The **Shrines** tab reads guild-credit conversions and shrine level costs from the game's client definitions. It first observes live game messages and also checks the game's read-only cached `initClientData` when those definitions were missed. It downloads the official [`marketplace.json`](https://www.milkywayidle.com/game_data/marketplace.json) feed and ranks tradeable materials by estimated coins per guild credit. The tab always shows market status, even if game definitions are unavailable; these are separate data sources.

Current asks are preferred because they represent the price to acquire a conversion material. If an ask is missing, the table may fall back to the feed's fair value or bid and labels that source. The feed does not provide full order-book depth, so a large purchase may cost more than the estimate. The general Guild Token is valued through its most valuable available guild-credit route. Shrine totals therefore represent opportunity cost, not a guaranteed direct purchase price.

Shrine estimates are grouped under collapsible Force, Tempo, Spirit, Rarity, and Scholar headings. Each group contains its combat and skilling buff levels with incremental and cumulative costs. Open groups remain open after prices refresh, and searching expands matching groups. Use **Refresh prices** to reread the market feed and retry cached game definitions; otherwise the browser cache is reused for 65 minutes to avoid unnecessary requests. The official feed may not have a newer snapshot on every refresh. If conversion or shrine rules remain missing, reload the game after enabling the userscript and open Guild Shop.

## Privacy and safety

- No account tokens, passwords, inventory, chat, or private messages are stored.
- Only the current guild roster, captured member skill levels, manual aura assignments, weekly participation observations, trial summaries, aggregate snapshots, and the latest official market snapshot are stored.
- Data stays in `localStorage` for `milkywayidle.com` unless you export a CSV.
- The only added network traffic is a cached GET to Milky Way Idle's official `game_data/marketplace.json`; there are no third-party analytics, gameplay requests, or WebSocket send calls.

Milky Way Idle permits scripts and extensions for information display and UI improvements, but prohibits them from taking player actions, including gameplay requests. This script only displays observed game data and the separately published official market snapshot. Review the current [game rules](https://www.milkywayidle.com/rules) before sharing or extending the script.

## Development

Run the aggregation tests with:

```powershell
npm test
```

The userscript is intentionally self-contained and requires no build step.
