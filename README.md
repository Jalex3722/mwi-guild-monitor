# MWI Guild Monitor

MWI Guild Monitor is a private, read-only Tampermonkey userscript for guild leaders and officers in [Milky Way Idle](https://www.milkywayidle.com/). It watches data that the game already sends to the current browser tab and builds a local guild dashboard.

It never sends commands or requests to the game server.

## Features

- Guild roster with role, online state, guild XP, and weekly XP when supplied by the game
- Member activity, strongest captured skill, profile freshness, and current trial choices
- Average, minimum, and maximum level for every captured skill
- Names of the members at each minimum and maximum, available as row tooltips
- Explicit profile coverage so partial averages cannot be mistaken for full-guild results
- Missing-profile checklist
- Locally cached member profiles and capture age
- Manual snapshots with average-level change comparison
- Weekly skilling and combat trial signup counts
- Per-trial signup levels, level ranges, minimum requirements, and member rosters
- Combat role distribution for each combat trial
- Manual desired-aura assignments for guild members
- Per-combat-trial aura coverage, missing-aura, and duplicate-aura warnings
- Aura-player tracking for unsigned and incorrectly grouped designated players
- Balanced skilling-trial allocation suggestions based on captured member levels
- CSV export for Excel or Google Sheets, including guild XP, trial signups, and aura assignments
- Local-only storage in the current browser

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Open the [raw userscript](https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js).
3. Confirm the installation in Tampermonkey.
4. Reload Milky Way Idle.
5. Select the **GM** button at the lower-right corner of the game.

The script includes `@updateURL` and `@downloadURL` metadata. Tampermonkey will detect a pushed release when its `@version` is newer than the installed version. You can also trigger **Check for userscript updates** from the Tampermonkey dashboard.

## Collecting member skill data

The game sends the guild roster automatically, but it does not include every member's full skill list in that roster. Full skills arrive when the game displays a profile.

1. Open Milky Way Idle's **Guild > Members** panel.
2. Open each member's **Profile** normally.
3. The userscript passively captures the `profile_shared` response and caches it.
4. Check **GM > Missing profiles** until coverage reaches 100%.

This is intentionally manual. Automatically requesting every profile would send actions to the game server and would conflict with the game's extension rules.

## Reading the dashboard

The skill table uses a simple arithmetic mean of the captured members' displayed levels. `Min` and `Max` are the lowest and highest displayed level for that skill. Hover over a skill row to see which members currently hold those values.

`Coverage` is the number of current roster members with a cached profile divided by the roster size. Statistics with less than 100% coverage are valid only for the captured subset.

Select **Snapshot** to save the current aggregate locally. The `Change` column compares the current average with the latest saved snapshot. Because profiles are captured at different times, treat snapshots as operational estimates rather than synchronized leaderboard records.

## Guild trials

The **Trials** tab reads the current weekly trial set and the signup information already sent to the game. It shows:

- How many members signed up for skilling and combat trials
- Which members have not signed up for each category
- Signup-time skill or combat levels
- Guild-configured minimum level requirements
- Combat role counts for each combat trial
- Suggested skilling allocations for members with captured profiles

The skilling recommendation is deliberately simple and visible. It filters out trials whose minimum level the member does not meet, prioritizes the member's strongest relevant skill, and caps each suggested roster near an even share of the covered members. Specialized members are assigned first. A suggestion marked **Review** means the balanced allocation differs from the member's current signup; it does not mean the current choice is necessarily wrong.

Combat recommendations are not generated. Combat level alone cannot account for equipment, abilities, consumables, roles, or encounter mechanics, so the dashboard reports combat roster and role coverage without presenting a misleading “best” encounter.

## Aura planning

Open the **Auras** tab to assign one desired aura to each designated guild member. The available choices match the current combat aura set:

- Speed Aura, scaling with Attack
- Guardian Aura, scaling with Defense
- Fierce Aura, scaling with Melee
- Critical Aura, scaling with Ranged
- Mystic Aura, scaling with Magic

The assignment table shows the member's captured scaling-skill level and current combat-trial signup. The Trials tab then evaluates each combat roster independently. An aura is **covered** when exactly one designated player is signed up for that trial, **missing** when nobody is designated, and **duplicate** when two or more designated players for that aura are in the same trial.

Aura assignments are manual planning labels. The script does not inspect equipped trial loadouts, equip abilities, or change signups. Assignments are saved per guild in the same local browser storage as captured profiles.

## Privacy and safety

- No account tokens, passwords, inventory, chat, or private messages are stored.
- Only the current guild roster, captured member skill levels, manual aura assignments, trial summaries, and aggregate snapshots are stored.
- Data stays in `localStorage` for `milkywayidle.com` unless you export a CSV.
- The script has no network permissions and contains no `fetch`, `XMLHttpRequest`, or WebSocket send calls.

Milky Way Idle permits scripts and extensions for information display and UI improvements, but prohibits them from taking player actions or sending requests to the server. Review the current [game rules](https://www.milkywayidle.com/rules) before sharing or extending the script.

## Development

Run the aggregation tests with:

```powershell
npm test
```

The userscript is intentionally self-contained and requires no build step.
