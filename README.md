# MWI Guild Monitor

MWI Guild Monitor is a private Tampermonkey userscript for guild leaders and officers in [Milky Way Idle](https://www.milkywayidle.com/). It watches data that the game already sends to the current browser tab and builds a local guild dashboard.

It never sends gameplay commands or automatically requests profiles. Its only additional request is a cached read-only GET to the game's official market-price feed.

## Features

- Guild roster with role, online state, guild XP, and weekly XP when supplied by the game
- Member activity, 3-day offline warnings, strongest captured skill, and color-coded current trial signups
- Average, median, minimum, and maximum level for every captured skill
- Visible highest-level member names and counts above levels 100, 125, and 150
- Total Level counts above 1500, 1800, and 2000
- Emoji icons beside skill names
- Current-week warnings when a member above level 125 did not join that skill's trial
- Explicit profile coverage so partial averages cannot be mistaken for full-guild results
- Missing-profile roster with last-viewed timestamps for every member
- Locally cached member profiles and capture age
- Manual snapshots with average-level change comparison
- Weekly skilling and combat trial signup counts
- Previous-week signup tracking, with an unsigned status recorded only when neither trial category was joined
- Per-trial signup levels, level ranges, minimum requirements, and member rosters
- Combat role distribution for each combat trial
- Combat-level defaults and manual special-ability assignments, including Insanity and Revive
- Per-combat-trial aura coverage, missing-aura, and duplicate-aura warnings
- Per-combat-trial Insanity and Revive counts with assigned player names
- Member-level assignment status for designated special-ability users
- First and second weekly trial choices ranked by each member's level relative to the captured guild median
- Guild Point balances and local change history
- Guild leaderboard positions and observed top-100 skill ranks beside members' names
- Guild building and shrine levels, next-upgrade costs, shortfalls, and expandable level-cost schedules
- Cheapest market-priced material conversion for every guild credit type
- Incremental and cumulative coin estimates for every guild shrine level
- CSV export for Excel or Google Sheets, including guild XP, offline duration, prior-week status, trial signups, and special-ability assignments
- Local-only storage in the current browser

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Open the [raw userscript](https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js).
3. Confirm the installation in Tampermonkey.
4. Reload Milky Way Idle.
5. Select the **GM** button at the lower-right corner of the game.

The script includes `@updateURL` and `@downloadURL` metadata. Tampermonkey will detect a pushed release when its `@version` is newer than the installed version. You can also trigger **Check for userscript updates** from the Tampermonkey dashboard.

The monitor header displays its running version. The current release is `v0.9.20`.

## Collecting member skill data

The game sends the guild roster automatically, but it does not include every member's full skill list in that roster. Full skills arrive when the game displays a profile.

1. Open Milky Way Idle's **Guild > Members** panel.
2. Open each member's **Profile** normally.
3. The userscript passively captures the `profile_shared` response and caches it.
4. Check **GM > Missing profiles** until coverage reaches 100%.

The **Get profile** button next to a member in Missing profiles fills the game's *empty* chat draft with `/profile CharacterName` and focuses it while keeping the GM panel open and your place in the list. You must press Enter yourself to open the profile. It never submits the command or overwrites an existing draft, including whitespace. If the game chat box is closed or cannot be identified, it leaves the draft alone and shows a notice.

Combat level is captured from the profile's separate `combatLevel` field and included with the member's cached skill levels. Previously captured profiles need to be opened again to add their Combat level.

This is intentionally manual. Automatically requesting every profile would send actions to the game server and would conflict with the game's extension rules.

## Reading the dashboard

The skill table shows both the arithmetic mean and median of captured members' displayed levels. `Min` and `Max` are the lowest and highest displayed level for that skill. The max-level member names are shown directly. Regular skill threshold columns count levels strictly greater than 100, 125, and 150; the Total Level row counts strictly greater than 1500, 1800, and 2000. Hover over a count to see its members and levels. Skill names use emoji approximations of the game's icons, with a neutral symbol for unfamiliar skills. The default order keeps Total Level first, then Milking through Magic in the game's skill-list order; unlisted skills follow alphabetically. For skills not offered in this week's skilling trials, `Over 125 not in trial` displays `N/A`.

For a skill offered in the current weekly trials, `>125 not in trial` lists captured members above level 125 who chose another skilling trial or no skilling trial. This is deliberately separate from the general participation warning, which only lists members who joined neither a skilling nor a combat trial.

`Coverage` is the number of current roster members with a cached profile divided by the roster size. Statistics with less than 100% coverage are valid only for the captured subset.

Select **Snapshot** to save the current aggregate locally. The `Change` column compares the current average with the latest saved snapshot. Because profiles are captured at different times, treat snapshots as operational estimates rather than synchronized leaderboard records.

The **Members** tab places each captured member's first and second median-fit trial choices beside their name. It also flags a player after a known offline duration reaches 72 hours. A hidden online status or unavailable timestamp is shown separately and is never treated as a 3-day absence.

In the **Current trials** column, green text and a green dot mean the member is signed up for that skilling or combat trial this week. Red **None** means no current signup in that category. The **Missing profiles** tab lists the full roster, with profiles still needed first, and shows when this browser last captured each available profile (both relative time and local date/time). It does not reconstruct profiles viewed before the monitor was installed.

The first and second choices use `member level - captured guild median`. They highlight where a member is strongest relative to the guild, but do not model attendance, equipment, consumables, or roster quotas.

## Guild trials

The **Trials** tab reads the current weekly trial set and the signup information already sent to the game. It shows:

- How many members signed up for skilling and combat trials
- Which members signed up for neither skilling nor combat; category-specific absence is not treated as a general participation warning
- Signup-time skill or combat levels
- Guild-configured minimum level requirements
- Combat role counts for each combat trial
- Actual skilling signup rosters

The Trials tab displays actual signup rosters and signup-time levels when available.

The Trials signup tables show current slots and remaining capacity. Each skilling trial has `20 + 2 × Skilling Encampment level` slots; each combat trial has `40 + 4 × Combat Encampment level` slots. Capacity is shown as unknown until the client supplies guild building levels.

The **Results** tab keeps a rolling 12-week local record of trial status, highest cleared tier, and Guild Points reported in the game's current trial state. It records only weeks observed by this browser while the script runs; it cannot reconstruct unobserved past results.

Combat recommendations are not generated. Combat level alone cannot account for equipment, abilities, consumables, roles, or encounter mechanics, so the dashboard reports combat roster and role coverage without presenting a misleading “best” encounter.

The script keeps a rolling local ledger of the latest signup state it observed for each guild week. In the following week, **No signup** means the member was still unsigned in both categories when observed during the final 24 hours of the prior week. **Signed** means either signup was observed. **Unknown** means the member was not observed late enough to establish an unsigned status, or that week was not observed at all. The monitor records signup state, not actual trial attendance.

## Guild Points, buildings, and leaderboards

The **Guild** tab shows available and lifetime Guild Points from the current guild state, this week's observed trial points, and the latest ten Guild Point balance changes captured by this browser. It lists all building and shrine levels known to the game client. Next-upgrade costs, affordability gaps, total cost to max level, and expandable per-level Guild Point costs use the game's building and shrine definitions. Unknown costs remain blank rather than estimated.

Shrines use the game's display order in both Guild and Shrines views: Force, Tempo, Spirit, Rarity, Scholar. The Guild tab's level and next-cost sorts can temporarily reorder them when selected.

Buildings in the Guild tab follow the game's display order, starting with Guild Hall, Builder's Hall, Treasury, and Archives, then the encampments and skill buildings. The level and next-cost sorts can temporarily reorder them when selected.

Guild leaderboard positions and top-100 member skill positions are captured from `leaderboard_updated` messages when you open those categories in the game's Leaderboard panel. The monitor makes no leaderboard requests. Observations are cached locally per guild with a timestamp; revisit a category to refresh it. A missing member badge means the category has not been observed here or that the member was not in its top 100 at the last observation. It is not a live global ranking check.

## Special ability planning

Open the **Auras** tab to designate one special ability per guild member. The choices include five auras and two utility abilities:

- Speed Aura, scaling with Attack
- Guardian Aura, scaling with Defense
- Fierce Aura, scaling with Melee
- Critical Aura, scaling with Ranged
- Mystic Aura, scaling with Magic
- Insanity
- Revive

When a captured profile has a Combat level, the default is **Insanity** at level 110 or higher and **Revive** below 110. Without a captured Combat level, the member stays unassigned. These defaults follow updated profiles and appear in the Auras, Members, Trials, and CSV views. A manual selection, including **No special assigned**, overrides the default; choose **Auto** to restore it.

The assignment table shows a captured scaling-skill level for auras or Combat level for utility abilities, plus the member's current combat-trial signup. The Trials tab evaluates each combat roster independently. An aura is **covered** when exactly one designated player is signed up for that trial, **missing** when nobody is designated, and **duplicate** when two or more designated players for that aura are in the same trial. Insanity and Revive are listed separately with their assigned player names and counts; multiple users are allowed and they do not affect aura coverage.

Special-ability assignments are planning labels. The script does not inspect equipped trial loadouts, equip abilities, or change signups. Existing manual aura assignments are preserved, and manual overrides are saved per guild in the same local browser storage as captured profiles.

## Shrine economics

The **Shrines** tab reads guild-credit conversions and shrine level costs from the game's client definitions. It first observes live game messages and also checks the game's read-only cached `initClientData` when those definitions were missed. It downloads the official [`marketplace.json`](https://www.milkywayidle.com/game_data/marketplace.json) feed and ranks tradeable materials by estimated coins per guild credit. The tab always shows market status, even if game definitions are unavailable; these are separate data sources.

Current asks are preferred because they represent the price to acquire a conversion material. If an ask is missing, the table may fall back to the feed's fair value or bid and labels that source. The feed does not provide full order-book depth, so a large purchase may cost more than the estimate. The general Guild Token is valued through its most valuable available guild-credit route. Shrine totals therefore represent opportunity cost, not a guaranteed direct purchase price.

Shrine estimates are grouped under collapsible Force, Tempo, Spirit, Rarity, and Scholar headings. Each group contains its combat and skilling buff levels with incremental and cumulative costs. Open groups remain open after prices refresh, and searching expands matching groups. Use **Refresh prices** to reread the market feed and retry cached game definitions; otherwise the browser cache is reused for 65 minutes to avoid unnecessary requests. The official feed may not have a newer snapshot on every refresh. If conversion or shrine rules remain missing, reload the game after enabling the userscript and open Guild Shop.

## Privacy and safety

- No account tokens, passwords, inventory, chat, or private messages are stored.
- Only the current guild roster, captured member skill levels, manual special-ability assignments, weekly participation observations, trial summaries, aggregate snapshots, and the latest official market snapshot are stored.
- Data stays in `localStorage` for `milkywayidle.com` unless you export a CSV.
- The only added network traffic is a cached GET to Milky Way Idle's official `game_data/marketplace.json`; there are no third-party analytics, gameplay requests, or WebSocket send calls.

Milky Way Idle permits scripts and extensions for information display and UI improvements, but prohibits them from taking player actions, including gameplay requests. This script only displays observed game data and the separately published official market snapshot. Review the current [game rules](https://www.milkywayidle.com/rules) before sharing or extending the script.

## Development

Run the aggregation tests with:

```powershell
npm test
```

The userscript is intentionally self-contained and requires no build step.
