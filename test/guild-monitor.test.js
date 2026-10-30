"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../mwi-guild-monitor.user.js");

const roster = Core.normalizeRoster(
    {
        1: { characterID: 1, guildRole: "leader", experience: 1200, weeklyExperience: 200 },
        2: { characterID: 2, guildRole: "officer", experience: 800, weeklyExperience: 100 },
        3: { characterID: 3, guildRole: "member", experience: 400, weeklyExperience: 50 },
    },
    {
        1: { id: 1, name: "Ada", isOnline: true },
        2: { id: 2, name: "Babbage", isOnline: false },
        3: { id: 3, name: "Curie", isOnline: false },
    },
);

const profiles = {
    1: {
        id: "1",
        name: "Ada",
        capturedAt: 1000,
        skills: [
            { skillHrid: "/skills/total_level", level: 1000, experience: 0 },
            { skillHrid: "/skills/cooking", level: 80, experience: 0 },
        ],
    },
    2: {
        id: "2",
        name: "Babbage",
        capturedAt: 2000,
        skills: [
            { skillHrid: "/skills/total_level", level: 800, experience: 0 },
            { skillHrid: "/skills/cooking", level: 40, experience: 0 },
        ],
    },
};

test("normalizes the guild roster", () => {
    assert.equal(roster.length, 3);
    assert.deepEqual(roster.map((member) => member.name), ["Ada", "Babbage", "Curie"]);
    assert.equal(roster[0].role, "leader");
    assert.equal(roster[0].isOnline, true);
});

test("calculates average, minimum, maximum, and coverage", () => {
    const result = Core.aggregateGuild(roster, profiles, {
        "/skills/cooking": { name: "Cooking" },
    });
    const cooking = result.skills.find((skill) => skill.skillHrid === "/skills/cooking");

    assert.equal(result.memberCount, 3);
    assert.equal(result.coveredCount, 2);
    assert.equal(result.coverage, 2 / 3);
    assert.equal(result.missingMembers[0].name, "Curie");
    assert.equal(cooking.average, 60);
    assert.equal(cooking.median, 60);
    assert.equal(cooking.minLevel, 40);
    assert.equal(cooking.maxLevel, 80);
    assert.deepEqual(cooking.minMembers, ["Babbage"]);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
    assert.equal(cooking.thresholdCounts[100].count, 0);
});

test("tracks total levels over 1500, 1800, and 2000", () => {
    const levels = [1500, 1800, 2000, 2001];
    const members = levels.map((_, index) => ({ id: String(index + 1), name: `Member ${index + 1}` }));
    const captured = Object.fromEntries(members.map((member, index) => [member.id, {
        id: member.id, name: member.name, capturedAt: 1,
        skills: [
            { skillHrid: Core.TOTAL_LEVEL_HRID, level: levels[index] },
            { skillHrid: "/skills/cooking", level: 151 },
        ],
    }]));
    const aggregate = Core.aggregateGuild(members, captured);
    const total = aggregate.skills.find((skill) => skill.skillHrid === Core.TOTAL_LEVEL_HRID);
    const cooking = aggregate.skills.find((skill) => skill.skillHrid === "/skills/cooking");
    const snapshot = Core.makeSnapshot({ id: "guild", name: "Guild" }, aggregate);

    assert.deepEqual(Core.TOTAL_LEVEL_THRESHOLDS, [1500, 1800, 2000]);
    assert.equal(total.thresholdCounts[1500].count, 3);
    assert.equal(total.thresholdCounts[1800].count, 2);
    assert.deepEqual(total.thresholdCounts[2000].members.map((member) => member.memberName), ["Member 4"]);
    assert.equal(cooking.thresholdCounts[150].count, 4);
    assert.equal(cooking.thresholdCounts[1500], undefined);
    assert.equal(snapshot.skills[Core.TOTAL_LEVEL_HRID].above2000, 1);
});

test("provides skill emojis with a fallback", () => {
    const expected = {
        [Core.TOTAL_LEVEL_HRID]: "🏅",
        "/skills/labyrinth": "🌀",
        "/skills/milking": "🥛",
        "/skills/foraging": "🍄",
        "/skills/woodcutting": "🌳",
        "/skills/mining": "⛏️",
        "/skills/cheesesmithing": "🧀",
        "/skills/crafting": "🪛",
        "/skills/tailoring": "👕",
        "/skills/cooking": "🧑‍🍳",
        "/skills/brewing": "🍵",
        "/skills/alchemy": "⚛️",
        "/skills/enhancing": "🔍",
        "/skills/combat": "⚔️",
        "/skills/stamina": "❤️",
        "/skills/intelligence": "🧠",
        "/skills/attack": "🗡️",
        "/skills/defense": "🛡️",
        "/skills/melee": "👊",
        "/skills/ranged": "🏹",
        "/skills/magic": "🪄",
    };
    Object.entries(expected).forEach(([hrid, emoji]) => assert.equal(Core.getSkillEmoji(hrid), emoji, hrid));
    assert.equal(Core.getSkillEmoji("/skills/new_skill"), "✦");
});

test("normalizes a profile response", () => {
    const profile = Core.normalizeProfile({
        sharableCharacter: { id: 7, name: "Grace" },
        characterSkills: [{ skillHrid: "/skills/foraging", level: 72, experience: 123 }],
    }, 5000);

    assert.equal(profile.id, "7");
    assert.equal(profile.name, "Grace");
    assert.equal(profile.capturedAt, 5000);
    assert.equal(profile.skills[0].level, 72);
});

test("exports quoted CSV cells", () => {
    const result = Core.aggregateGuild(
        [{ ...roster[0], name: "Ada, First" }],
        { 1: { ...profiles[1], name: "Ada, First" } },
        { "/skills/cooking": { name: "Cooking" } },
    );
    const csv = Core.toCsv(result, { "/skills/cooking": { name: "Cooking" } });

    assert.match(csv, /"Ada, First"/);
    assert.match(csv, /Cooking/);
});

test("creates snapshots and finds the previous one", () => {
    const aggregate = Core.aggregateGuild(roster, profiles);
    const first = Core.makeSnapshot({ id: 10, name: "Milk Lab" }, aggregate, 1000);
    const second = Core.makeSnapshot({ id: 10, name: "Milk Lab" }, aggregate, 2000);

    assert.equal(first.coveredCount, 2);
    assert.equal(first.skills["/skills/cooking"].average, 60);
    assert.equal(Core.getPreviousSnapshot([first, second], 3000), second);
});

test("tracks current guild-trial signups and signup levels", () => {
    const weekStart = Date.UTC(2026, 9, 23);
    const members = Core.aggregateGuild(
        roster.map((member, index) => ({
            ...member,
            signedUpSkillingTrialHrid: index < 2 ? "/guild_skilling/cooking" : "",
            signedUpCombatTrialHrid: index === 0 ? "/guild_combat/badger" : "",
            signedUpCombatRoleHrid: index === 0 ? "/combat_roles/tank" : "",
            signupWeekStartAt: weekStart,
        })),
        profiles,
    );
    const analysis = Core.analyzeTrials({
        aggregate: members,
        weeklyTrialSet: {
            skillHrids: ["/guild_skilling/cooking", "/guild_skilling/mining"],
            combatHrids: ["/guild_combat/badger"],
        },
        trialDetails: {
            "/guild_skilling/cooking": { kind: "skilling", skillHrid: "/skills/cooking" },
            "/guild_skilling/mining": { kind: "skilling", skillHrid: "/skills/mining" },
            "/guild_combat/badger": { kind: "combat" },
        },
        signupLevels: {
            1: { skillingTrialLevel: 80, combatLevel: 145 },
            2: { skillingTrialLevel: 40 },
        },
        guildWeekStartAt: weekStart,
        now: weekStart + 86_400_000,
    });

    assert.equal(analysis.skillingSignedCount, 2);
    assert.equal(analysis.combatSignedCount, 1);
    assert.equal(analysis.skilling[0].averageLevel, 60);
    assert.equal(analysis.combat[0].roles["/combat_roles/tank"], 1);
    assert.equal(analysis.anyTrialSignedCount, 2);
    assert.equal(analysis.unsignedTrials.length, 1);
    assert.equal(analysis.unsignedTrials[0].name, "Curie");
});

test("does not invent optimal positions when no profiles are captured", () => {
    const aggregate = Core.aggregateGuild([
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
    ], {});
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook"] },
        trialDetails: { cook: { skillHrid: "/skills/cooking" } },
    });

    assert.equal(aggregate.coveredCount, 0);
    assert.deepEqual(analysis.skilling[0].signups.map((entry) => entry.memberName), ["Ada"]);
    assert.deepEqual(analysis.recommendations, []);
    assert.deepEqual(analysis.optimalDistribution[0].assignments, []);
    assert.equal(analysis.memberComparisons[0].recommendedTrialName, "Unknown");
    assert.equal(analysis.memberComparisons[0].signupStatus, "missingProfile");
    assert.equal(analysis.optimalDistribution[0].targetAverageLevel, null);
});

test("calculates trial capacity from encampment levels", () => {
    const levels = {
        "/guild_buildings/skilling_encampment": 3,
        "/guild_buildings/combat_encampment": 2,
    };
    assert.equal(Core.getTrialCapacity("skilling", levels), 26);
    assert.equal(Core.getTrialCapacity("combat", levels), 48);
    assert.equal(Core.getTrialCapacity("skilling", {}), 20);
    assert.equal(Core.getTrialCapacity("combat", {}), 40);
    assert.equal(Core.getTrialCapacity("skilling", null), null);
    assert.equal(Core.getTrialCapacity("combat", null), null);

    const analysis = Core.analyzeTrials({
        aggregate: Core.aggregateGuild([], {}),
        weeklyTrialSet: { skillHrids: ["/trials/skilling"], combatHrids: ["/trials/combat"] },
        buildingLevels: levels,
    });
    assert.equal(analysis.skilling[0].capacity, 26);
    assert.equal(analysis.combat[0].capacity, 48);
});

test("tracks guild structure levels and Guild Point upgrade costs", () => {
    const guild = { id: 42, name: "Cows", guildPoints: 120, lifetimeGuildPoints: 520 };
    const levels = { "/guild_buildings/guild_hall": 1, "/guild_shrines/force": 2 };
    const buildings = { "/guild_buildings/guild_hall": { maxLevel: 3, guildPointCosts: { 1: 100, 2: 200, 3: 300 }, sortIndex: 1 } };
    const shrines = { "/guild_shrines/force": { maxLevel: 3, guildPointCosts: [null, 10, 20, 30] } };
    const result = Core.analyzeGuildStructures(guild, levels, buildings, shrines);

    assert.equal(result.availablePoints, 120);
    assert.equal(result.lifetimePoints, 520);
    assert.equal(result.buildings[0].currentLevel, 1);
    assert.equal(result.buildings[0].nextCost, 200);
    assert.equal(result.buildings[0].shortfall, 80);
    assert.equal(result.buildings[0].remainingCost, 500);
    assert.deepEqual(result.buildings[0].levelCosts.map((entry) => entry.cost), [100, 200, 300]);
    assert.equal(result.shrines[0].nextCost, 30);
    assert.equal(result.shrines[0].shortfall, 0);
    const maxed = Core.analyzeGuildStructures(guild, { "/guild_buildings/guild_hall": 3 }, buildings).buildings[0];
    assert.equal(maxed.remainingCost, 0);
    assert.equal(maxed.maxed, true);
    assert.equal(Core.analyzeGuildStructures(guild, null, buildings).buildings[0].nextCost, null);
    const missingCost = Core.analyzeGuildStructures(guild, levels, { "/guild_buildings/guild_hall": { maxLevel: 2, guildPointCosts: { 2: null } } });
    assert.equal(missingCost.buildings[0].nextCost, null);
});

test("records only changed Guild Point balances", () => {
    const first = Core.recordGuildPointsHistory([], { guildPoints: 0, lifetimeGuildPoints: 400 }, 1);
    const unchanged = Core.recordGuildPointsHistory(first, { guildPoints: 0, lifetimeGuildPoints: 400 }, 2);
    const changed = Core.recordGuildPointsHistory(unchanged, { guildPoints: 20, lifetimeGuildPoints: 420 }, 3);
    assert.equal(unchanged, first);
    assert.deepEqual(changed, [
        { available: 0, lifetime: 400, observedAt: 1 },
        { available: 20, lifetime: 420, observedAt: 3 },
    ]);
});

test("captures observed top-100 member ranks and clears outdated positions", () => {
    const guild = { id: 42, name: "Cows" };
    const members = [{ id: "1", name: "Ada" }, { id: "2", name: "Babbage" }];
    const message = (revision, rows) => ({
        leaderboardType: "standard", leaderboardCategory: "cooking", leaderboardRevision: revision,
        leaderboard: { rows },
    });
    const first = Core.recordLeaderboardObservation({}, message(1, [
        { id: 1, name: "Ada", rank: 7 }, { id: 2, name: "Babbage", rank: 101 },
    ]), guild, members, {}, 1000);
    assert.deepEqual(Core.getMemberLeaderboardSpots(first, members[0]).map((spot) => [spot.category, spot.rank]), [["cooking", 7]]);
    assert.deepEqual(Core.getMemberLeaderboardSpots(first, members[1]), []);

    const second = Core.recordLeaderboardObservation(first, message(2, [{ id: 2, name: "Babbage", rank: 99 }]), guild, members, {}, 2000);
    assert.deepEqual(Core.getMemberLeaderboardSpots(second, members[0]), []);
    assert.deepEqual(Core.getMemberLeaderboardSpots(second, members[1]).map((spot) => spot.rank), [99]);
    assert.equal(Core.recordLeaderboardObservation(second, message(1, []), guild, members, {}, 3000), second);
    const byName = Core.recordLeaderboardObservation(second, message(3, [{ id: "different-id", name: "Ada", rank: 8 }]), guild, members, {}, 4000);
    assert.deepEqual(Core.getMemberLeaderboardSpots(byName, members[0]).map((spot) => spot.rank), [8]);
});

test("tracks observed guild leaderboard ranks including personal rows", () => {
    const guild = { id: 42, name: "Cows" };
    const message = {
        leaderboardType: "guild", leaderboardCategory: "guild_points", guildTypeFilter: "standard",
        leaderboardRevision: 5, leaderboard: { rows: [] }, personalRow: { id: 42, name: "Cows", rank: 122 },
    };
    const observed = Core.recordLeaderboardObservation({}, message, guild, [], {}, 4000);
    assert.deepEqual(Core.getGuildLeaderboardSpots(observed).map((board) => [board.category, board.guildRank, board.filter]), [["guild_points", 122, "standard:all:all"]]);
    const cleared = Core.recordLeaderboardObservation(observed, { ...message, leaderboardRevision: 6, personalRow: null }, guild, [], {}, 5000);
    assert.deepEqual(Core.getGuildLeaderboardSpots(cleared), []);
});

test("records observed trial results without losing signup history", () => {
    const week = Date.UTC(2026, 9, 23);
    const original = { [week]: { weekStartAt: week, members: { 1: { signedSkilling: true } } } };
    const first = Core.recordWeeklyTrialResults(original, JSON.stringify({
        skilling: { status: "in_progress", parties: { cook: { highestTier: 2 } } },
        combat: { status: "scheduled", parties: {} },
        points: { cook: 120 },
    }), { skillHrids: ["cook"], combatHrids: ["badger"] }, week, week + 1000);
    const second = Core.recordWeeklyTrialResults(first, {
        skilling: { status: "completed", parties: { cook: { highestTier: 3, done: true } } },
        points: { cook: 180 },
    }, { skillHrids: ["cook"], combatHrids: ["badger"] }, week, week + 2000);

    assert.equal(second[week].members[1].signedSkilling, true);
    assert.equal(second[week].results.cook.highestTier, 3);
    assert.equal(second[week].results.cook.points, 180);
    assert.equal(second[week].results.cook.done, true);
    assert.equal(second[week].results.badger.status, "scheduled");
    const afterSignupObservation = Core.recordWeeklyTrialParticipation(second, Core.aggregateGuild([
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
    ], {}), week, week + 3000);
    assert.equal(afterSignupObservation[week].results.cook.highestTier, 3);
});

test("tracks high-level members missing a specific skilling trial", () => {
    const highLevelRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpSkillingTrialHrid: "cook", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", role: "officer", signedUpSkillingTrialHrid: "mine", signedUpCombatTrialHrid: "" },
        { id: "3", name: "Curie", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "" },
    ];
    const highLevelProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 151 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 140 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 130 }] },
        4: { id: "4", name: "Noether", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 125 }] },
    };
    const aggregate = Core.aggregateGuild(highLevelRoster, highLevelProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook"], combatHrids: ["badger"] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            badger: { kind: "combat", name: "Badger" },
        },
    });
    const cooking = aggregate.skills.find((skill) => skill.skillHrid === "/skills/cooking");
    const cookingGap = analysis.highLevelSkillGaps.find((gap) => gap.skillHrid === "/skills/cooking");

    assert.equal(cooking.thresholdCounts[100].count, 4);
    assert.equal(cooking.thresholdCounts[125].count, 3);
    assert.equal(cooking.thresholdCounts[150].count, 1);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
    assert.deepEqual(cookingGap.members.map((member) => member.memberName), ["Babbage", "Curie"]);
    assert.deepEqual(analysis.unsignedTrials.map((member) => member.name), ["Noether"]);
    assert.deepEqual(analysis.recommendations.map((entry) => entry.memberName).sort(), ["Ada", "Babbage", "Curie", "Noether"]);
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Curie").signupStatus, "combatOnly");
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Noether").signupStatus, "unsigned");
    assert.deepEqual(analysis.missingRecommendedSignup.map((entry) => entry.memberName).sort(), ["Curie", "Noether"]);
    assert.deepEqual(analysis.wrongRecommendedSignup.map((entry) => entry.memberName), ["Babbage"]);
    assert.equal(analysis.wrongRecommendedSignup[0].currentTrialName, "Mine");
    assert.equal(analysis.optimalDistribution[0].assignments.length, 4);
});

test("balances skilling recommendations while respecting minimum levels", () => {
    const recommendationRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Babbage", role: "officer", signedUpSkillingTrialHrid: "cook" },
        { id: "3", name: "Curie", role: "member", signedUpSkillingTrialHrid: "mine" },
        { id: "4", name: "Noether", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "badger" },
    ];
    const recommendationProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 100 }, { skillHrid: "/skills/mining", level: 70 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 90 }, { skillHrid: "/skills/mining", level: 95 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 80 }, { skillHrid: "/skills/mining", level: 100 }] },
        4: { id: "4", name: "Noether", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 96 }, { skillHrid: "/skills/mining", level: 91 }] },
    };
    const aggregate = Core.aggregateGuild(recommendationRoster, recommendationProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            mine: { skillHrid: "/skills/mining" },
        },
        trialMinLevels: JSON.stringify({ cook: 90, mine: 90 }),
    });
    const babbage = analysis.recommendations.find((entry) => entry.memberName === "Babbage");
    const cookingDistribution = analysis.optimalDistribution.find((entry) => entry.trialHrid === "cook");
    const miningDistribution = analysis.optimalDistribution.find((entry) => entry.trialHrid === "mine");

    assert.equal(analysis.recommendations.length, 4);
    assert.ok(babbage.recommendedLevel >= 90);
    assert.equal(analysis.recommendations.find((entry) => entry.memberName === "Noether").signupStatus, "combatOnly");
    assert.equal(analysis.recommendations.find((entry) => entry.memberName === "Ada").signupStatus, "aligned");
    assert.equal(cookingDistribution.assignments.length, 2);
    assert.equal(miningDistribution.assignments.length, 2);
    assert.ok(analysis.recommendations.every((entry) => entry.recommendedLevel >= 90));
});

test("recommends all eligible members and leaves missing profiles unknown", () => {
    const aggregate = Core.aggregateGuild([
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Babbage", signedUpSkillingTrialHrid: "cook" },
        { id: "3", name: "Curie", signedUpSkillingTrialHrid: "cook" },
        { id: "4", name: "Noether", signedUpSkillingTrialHrid: "mine" },
        { id: "5", name: "Unsigned", signedUpSkillingTrialHrid: "" },
    ], {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 140 }, { skillHrid: "/skills/mining", level: 100 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 90 }, { skillHrid: "/skills/mining", level: 150 }] },
        5: { id: "5", name: "Unsigned", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 180 }, { skillHrid: "/skills/mining", level: 180 }] },
    });
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"] },
        trialDetails: { cook: { skillHrid: "/skills/cooking" }, mine: { skillHrid: "/skills/mining" } },
    });

    assert.deepEqual(analysis.recommendations.map((entry) => entry.memberName).sort(), ["Ada", "Babbage", "Unsigned"]);
    assert.equal(analysis.optimalDistribution.reduce((sum, trial) => sum + trial.assignments.length, 0), 3);
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Curie").signupStatus, "missingProfile");
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Noether").signupStatus, "missingProfile");
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Unsigned").signupStatus, "unsigned");
    assert.deepEqual(analysis.missingRecommendedSignup.map((entry) => entry.memberName), ["Unsigned"]);
    assert.ok(analysis.wrongRecommendedSignup.every((entry) => entry.currentTrialHrid && entry.currentTrialHrid !== entry.recommendedTrialHrid));
    assert.equal(analysis.optimalDistribution.reduce((sum, trial) => sum + trial.unknownActualCount, 0), 2);
    assert.equal(analysis.allocationBalanced, true);
});

test("assigns single-trial members before flexible members", () => {
    const aggregate = Core.aggregateGuild([
        { id: "1", name: "Flexible", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Cooking only", signedUpSkillingTrialHrid: "cook" },
    ], {
        1: { id: "1", name: "Flexible", capturedAt: 1, skills: [
            { skillHrid: "/skills/cooking", level: 150 },
            { skillHrid: "/skills/mining", level: 110 },
        ] },
        2: { id: "2", name: "Cooking only", capturedAt: 1, skills: [
            { skillHrid: "/skills/cooking", level: 100 },
            { skillHrid: "/skills/mining", level: 80 },
        ] },
    });
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            mine: { skillHrid: "/skills/mining" },
        },
        trialMinLevels: { cook: 90, mine: 100 },
    });

    assert.deepEqual(analysis.optimalDistribution.map((trial) => trial.assignments.map((entry) => entry.memberName)), [
        ["Cooking only"],
        ["Flexible"],
    ]);
    const flexible = analysis.memberComparisons.find((entry) => entry.memberName === "Flexible");
    assert.equal(flexible.currentTrialHrid, "cook");
    assert.equal(flexible.recommendedTrialHrid, "mine");
    assert.equal(flexible.signupStatus, "different");
    assert.deepEqual(analysis.wrongRecommendedSignup.map((entry) => entry.memberName), ["Flexible"]);
    assert.deepEqual(analysis.missingRecommendedSignup, []);

    const changedSignups = Core.aggregateGuild([
        { id: "1", name: "Flexible", signedUpSkillingTrialHrid: "mine" },
        { id: "2", name: "Cooking only", signedUpSkillingTrialHrid: "mine" },
    ], Object.fromEntries(aggregate.members.map((member) => [member.id, member.profile])));
    const changedAnalysis = Core.analyzeTrials({
        aggregate: changedSignups,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: { cook: { skillHrid: "/skills/cooking" }, mine: { skillHrid: "/skills/mining" } },
        trialMinLevels: { cook: 90, mine: 100 },
    });
    assert.deepEqual(changedAnalysis.optimalDistribution.map((trial) => trial.assignments.map((entry) => entry.memberName)), [
        ["Cooking only"],
        ["Flexible"],
    ]);
    assert.equal(changedAnalysis.memberComparisons.find((entry) => entry.memberName === "Flexible").signupStatus, "aligned");
    assert.equal(changedAnalysis.memberComparisons.find((entry) => entry.memberName === "Cooking only").signupStatus, "different");
});

test("globally maximizes the combined average of four balanced skilling trials", () => {
    const trialHrids = ["cook", "mine", "brew", "wood"];
    const skillHrids = ["/skills/cooking", "/skills/mining", "/skills/brewing", "/skills/woodcutting"];
    const trialDetails = Object.fromEntries(trialHrids.map((hrid, index) => [hrid, { skillHrid: skillHrids[index] }]));
    const roster = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), name: `Member ${index + 1}`, signedUpSkillingTrialHrid: trialHrids[index % trialHrids.length] }));
    let seed = 197;
    const random = () => ((seed = (seed * 48271) % 2147483647) % 66) + 85;

    for (let fixture = 0; fixture < 12; fixture += 1) {
        const profiles = Object.fromEntries(roster.map((member) => [member.id, {
            id: member.id,
            name: member.name,
            capturedAt: 1,
            skills: skillHrids.map((skillHrid) => ({ skillHrid, level: random() })),
        }]));
        const aggregate = Core.aggregateGuild(roster, profiles);
        const analysis = Core.analyzeTrials({
            aggregate,
            weeklyTrialSet: { skillHrids: trialHrids, combatHrids: [] },
            trialDetails,
        });
        const levels = roster.map((member) => skillHrids.map((hrid) => profiles[member.id].skills.find((skill) => skill.skillHrid === hrid).level));
        const score = (choices) => {
            const counts = trialHrids.map((_, trial) => choices.filter((choice) => choice === trial).length);
            if (counts.some((count) => !count) || Math.max(...counts) - Math.min(...counts) > 1) return -Infinity;
            return trialHrids.reduce((sum, _, trial) => sum + choices.reduce((total, choice, member) =>
                total + (choice === trial ? levels[member][trial] : 0), 0) / counts[trial], 0);
        };
        let maximum = -Infinity;
        for (let encoded = 0; encoded < trialHrids.length ** roster.length; encoded += 1) {
            let remaining = encoded;
            const choices = roster.map(() => {
                const choice = remaining % trialHrids.length;
                remaining = Math.floor(remaining / trialHrids.length);
                return choice;
            });
            maximum = Math.max(maximum, score(choices));
        }
        const recommended = roster.map((member) => trialHrids.indexOf(analysis.recommendations.find((entry) => entry.memberId === member.id).recommendedTrialHrid));
        assert.ok(Math.abs(score(recommended) - maximum) < 1e-8, `fixture ${fixture}`);
        assert.ok(Math.abs(analysis.combinedTargetAverage - maximum) < 1e-8, `combined average ${fixture}`);
        assert.equal(analysis.targetCoveredTrialCount, 4);
        assert.equal(analysis.allocationBalanced, true);
    }
});

test("equal-level recommendations do not copy current signups", () => {
    const trials = ["cook", "mine", "brew", "wood"];
    const skills = ["/skills/cooking", "/skills/mining", "/skills/brewing", "/skills/woodcutting"];
    const profiles = Object.fromEntries(trials.map((_, index) => [String(index + 1), {
        id: String(index + 1), name: `Member ${index + 1}`, capturedAt: 1,
        skills: skills.map((skillHrid) => ({ skillHrid, level: 100 })),
    }]));
    const analyze = (signupForMember) => Core.analyzeTrials({
        aggregate: Core.aggregateGuild(trials.map((_, index) => ({
            id: String(index + 1), name: `Member ${index + 1}`,
            signedUpSkillingTrialHrid: signupForMember(index),
        })), profiles),
        weeklyTrialSet: { skillHrids: trials, combatHrids: [] },
        trialDetails: Object.fromEntries(trials.map((hrid, index) => [hrid, { skillHrid: skills[index] }])),
    });
    const unsigned = analyze(() => "");
    const positions = (analysis) => Object.fromEntries(analysis.recommendations.map((entry) => [entry.memberId, entry.recommendedTrialHrid]));
    const targetByMember = positions(unsigned);
    const signed = analyze((index) => trials[(trials.indexOf(targetByMember[String(index + 1)]) + 1) % trials.length]);

    assert.deepEqual(positions(signed), positions(unsigned));
    assert.equal(signed.combinedTargetAverage, 400);
    assert.equal(unsigned.missingRecommendedSignup.length, 4);
    assert.equal(signed.wrongRecommendedSignup.length, 4);
});

test("marks an infeasible even roster and retains every eligible member", () => {
    const aggregate = Core.aggregateGuild([
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Babbage", signedUpSkillingTrialHrid: "cook" },
    ], {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 120 }, { skillHrid: "/skills/mining", level: 50 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 110 }, { skillHrid: "/skills/mining", level: 60 }] },
    });
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: { cook: { skillHrid: "/skills/cooking" }, mine: { skillHrid: "/skills/mining" } },
        trialMinLevels: { cook: 90, mine: 100 },
    });

    assert.equal(analysis.allocationBalanced, false);
    assert.deepEqual(analysis.optimalDistribution.map((trial) => trial.assignments.length), [2, 0]);
    assert.equal(analysis.recommendations.length, 2);
    assert.equal(analysis.optimalDistribution[0].actualAverageLevel, 115);
    assert.equal(analysis.optimalDistribution[0].targetAverageLevel, 115);
    assert.equal(analysis.combinedTargetAverage, null);
});

test("global trial assignment respects level minimums", () => {
    const trialHrids = ["cook", "mine", "brew"];
    const skillHrids = ["/skills/cooking", "/skills/mining", "/skills/brewing"];
    const levels = [
        [140, 90, 90],
        [90, 140, 90],
        [90, 90, 140],
        [130, 120, 110],
        [110, 130, 120],
    ];
    const roster = levels.map((_, index) => ({ id: String(index + 1), name: `Member ${index + 1}`, signedUpSkillingTrialHrid: trialHrids[index % 3] }));
    const profiles = Object.fromEntries(roster.map((member, index) => [member.id, {
        id: member.id, name: member.name, capturedAt: 1,
        skills: skillHrids.map((skillHrid, skill) => ({ skillHrid, level: levels[index][skill] })),
    }]));
    const aggregate = Core.aggregateGuild(roster, profiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: trialHrids, combatHrids: [] },
        trialDetails: Object.fromEntries(trialHrids.map((hrid, index) => [hrid, { skillHrid: skillHrids[index] }])),
        trialMinLevels: { cook: 100, mine: 100, brew: 100 },
    });
    const choices = roster.map((member) => trialHrids.indexOf(analysis.recommendations.find((entry) => entry.memberId === member.id).recommendedTrialHrid));

    assert.equal(analysis.allocationBalanced, true);
    assert.deepEqual(choices.slice(0, 3), [0, 1, 2]);
    choices.forEach((choice, member) => assert.ok(levels[member][choice] >= 100));
    assert.deepEqual(analysis.optimalDistribution.map((trial) => trial.assignments.length).sort(), [1, 2, 2]);
});

test("tracks exact-one aura coverage for each combat trial", () => {
    const combatRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", role: "officer", signedUpCombatTrialHrid: "badger" },
        { id: "3", name: "Curie", role: "member", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", role: "member", signedUpCombatTrialHrid: "" },
    ];
    const aggregate = Core.aggregateGuild(combatRoster, {});
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: [], combatHrids: ["badger"] },
        trialDetails: { badger: { kind: "combat", name: "Badger" } },
        auraAssignments: {
            1: { auraHrid: "/abilities/speed_aura" },
            2: { auraHrid: "/abilities/guardian_aura" },
            3: { auraHrid: "/abilities/speed_aura" },
            4: { auraHrid: "/abilities/mystic_aura" },
        },
    });
    const badger = analysis.combat[0];
    const speed = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/speed_aura");
    const guardian = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/guardian_aura");
    const mystic = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/mystic_aura");
    const noether = analysis.auraTracking.find((entry) => entry.memberName === "Noether");

    assert.equal(speed.status, "duplicate");
    assert.deepEqual(speed.members.map((member) => member.memberName), ["Ada", "Curie"]);
    assert.equal(guardian.status, "covered");
    assert.equal(mystic.status, "missing");
    assert.equal(badger.auraCoveredCount, 1);
    assert.equal(noether.status, "unsigned");
    assert.equal(badger.utilityAssignments.find((ability) => ability.name === "Revive").count, 0);
});

test("tracks Insanity and Revive without changing exact-one aura coverage", () => {
    const members = [
        { id: "1", name: "Ada", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", signedUpCombatTrialHrid: "badger" },
        { id: "3", name: "Curie", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", signedUpCombatTrialHrid: "" },
    ];
    const aggregate = Core.aggregateGuild(members, {});
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: [], combatHrids: ["badger"] },
        trialDetails: { badger: { kind: "combat", name: "Badger" } },
        auraAssignments: {
            1: { auraHrid: "/abilities/insanity" },
            2: { auraHrid: "/abilities/revive" },
            3: { auraHrid: "/abilities/revive" },
            4: { auraHrid: "/abilities/insanity" },
        },
    });
    const trial = analysis.combat[0];
    const insanity = trial.utilityAssignments.find((ability) => ability.name === "Insanity");
    const revive = trial.utilityAssignments.find((ability) => ability.name === "Revive");
    const snapshot = Core.makeSnapshot({ id: "guild", name: "Guild" }, aggregate, 1, analysis);

    assert.equal(Core.getAuraDefinition("/abilities/revive"), null);
    assert.equal(Core.getSpecialAbilityDefinition("/abilities/revive").kind, "utility");
    assert.deepEqual(insanity.members.map((member) => member.memberName), ["Ada"]);
    assert.deepEqual(revive.members.map((member) => member.memberName), ["Babbage", "Curie"]);
    assert.equal(trial.auraCoveredCount, 0);
    assert.equal(trial.auraIssueCount, 5);
    assert.equal(analysis.auraTracking.find((entry) => entry.memberName === "Babbage").status, "assigned");
    assert.equal(analysis.auraTracking.find((entry) => entry.memberName === "Noether").status, "unsigned");
    assert.equal(snapshot.trials.combatUtilityAssignments.badger["/abilities/revive"], 2);
});

test("defaults special abilities by captured combat level without replacing manual choices", () => {
    const members = [
        { id: "1", name: "Below", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "At threshold", signedUpCombatTrialHrid: "badger" },
        { id: "3", name: "Manual aura", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Manual none", signedUpCombatTrialHrid: "badger" },
        { id: "5", name: "Unknown", signedUpCombatTrialHrid: "badger" },
    ];
    const combatProfiles = Object.fromEntries([109, 110, 130, 100].map((level, index) => [String(index + 1), {
        id: String(index + 1), name: members[index].name, capturedAt: 1,
        skills: [{ skillHrid: "/skills/combat", level }],
    }]));
    const aggregate = Core.aggregateGuild(members, combatProfiles);
    const assignments = {
        3: { auraHrid: "/abilities/speed_aura" },
        4: { auraHrid: "" },
    };
    assert.deepEqual(aggregate.members.map((member) => Core.getEffectiveAuraAssignment(assignments, member)), [
        "/abilities/revive", "/abilities/insanity", "/abilities/speed_aura", "", "",
    ]);
    assert.equal(Core.getEffectiveAuraAssignment({}, aggregate.members[2]), "/abilities/insanity");
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { combatHrids: ["badger"] },
        auraAssignments: assignments,
    });
    const badger = analysis.combat[0];
    assert.equal(badger.utilityAssignments.find((ability) => ability.name === "Insanity").count, 1);
    assert.equal(badger.utilityAssignments.find((ability) => ability.name === "Revive").count, 1);
    assert.equal(badger.auraCoverage.find((aura) => aura.name === "Speed Aura").count, 1);
    assert.match(Core.toCsv(aggregate, {}, {}, assignments), /Below[^\r\n]*Revive/);
    assert.match(Core.toCsv(aggregate, {}, {}, assignments), /At threshold[^\r\n]*Insanity/);
});

test("includes desired special abilities in CSV exports", () => {
    const aggregate = Core.aggregateGuild([roster[0], roster[1]], profiles);
    const csv = Core.toCsv(aggregate, {}, {}, {
        1: { auraHrid: "/abilities/critical_aura" },
        2: { auraHrid: "/abilities/revive" },
    });

    assert.match(csv, /Desired Special/);
    assert.match(csv, /Critical Aura/);
    assert.match(csv, /Revive/);
});

test("flags only known offline durations of at least three days", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    const members = [
        { id: "1", name: "Online", isOnline: true, lastActiveAt: now - 10 * Core.DAY_MS },
        { id: "2", name: "Recent", isOnline: false, lastActiveAt: now - 2 * Core.DAY_MS },
        { id: "3", name: "Inactive", isOnline: false, lastActiveAt: now - 3 * Core.DAY_MS },
        { id: "4", name: "Private", isOnline: false, hideOnlineStatus: true, lastActiveAt: now - 8 * Core.DAY_MS },
    ];
    const tracking = Core.buildMemberTracking(Core.aggregateGuild(members, {}), {}, null, now);
    const byName = Object.fromEntries(tracking.map((entry) => [entry.memberName, entry]));

    assert.equal(byName.Online.offlineDurationMs, null);
    assert.equal(byName.Recent.offlineThreeDays, false);
    assert.equal(byName.Inactive.offlineDurationMs, 3 * Core.DAY_MS);
    assert.equal(byName.Inactive.offlineThreeDays, true);
    assert.equal(byName.Private.offlineDurationMs, null);
    assert.equal(byName.Private.offlineThreeDays, false);
});

test("stores weekly trial participation and reports previous-week misses", () => {
    const currentWeek = Date.UTC(2026, 9, 23);
    const previousWeek = currentWeek - 7 * Core.DAY_MS;
    const priorAggregate = Core.aggregateGuild([
        { id: "1", name: "Skiller", signedUpSkillingTrialHrid: "cooking", signupWeekStartAt: previousWeek },
        { id: "2", name: "Fighter", signedUpCombatTrialHrid: "badger", signupWeekStartAt: previousWeek },
        { id: "3", name: "Absent", signupWeekStartAt: previousWeek },
    ], {});
    const history = Core.recordWeeklyTrialParticipation({}, priorAggregate, previousWeek, previousWeek + 6 * Core.DAY_MS);
    const currentAggregate = Core.aggregateGuild([
        ...priorAggregate.members,
        { id: "4", name: "Not Observed" },
    ], {});
    const tracking = Core.buildMemberTracking(currentAggregate, history, currentWeek, currentWeek + Core.DAY_MS);
    const status = Object.fromEntries(tracking.map((entry) => [entry.memberName, entry.previousWeekStatus]));

    assert.equal(status.Skiller, "participated");
    assert.equal(status.Fighter, "participated");
    assert.equal(status.Absent, "missed");
    assert.equal(status["Not Observed"], "unknown");
});

test("does not call an early unsigned observation a missed trial", () => {
    const currentWeek = Date.UTC(2026, 9, 23);
    const previousWeek = currentWeek - 7 * Core.DAY_MS;
    const aggregate = Core.aggregateGuild([{ id: "1", name: "Unsigned" }], {});
    const earlyHistory = Core.recordWeeklyTrialParticipation({}, aggregate, previousWeek, previousWeek + Core.DAY_MS);
    const lateHistory = Core.recordWeeklyTrialParticipation(earlyHistory, aggregate, previousWeek, previousWeek + 6 * Core.DAY_MS);

    assert.equal(Core.getPreviousWeekTrialStatus(earlyHistory, currentWeek, "1"), "unknown");
    assert.equal(Core.getPreviousWeekTrialStatus(lateHistory, currentWeek, "1"), "missed");
});

test("hides signups from a prior week in trial analysis and CSV", () => {
    const weekStart = Date.UTC(2026, 9, 23);
    const aggregate = Core.aggregateGuild([{
        id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook",
        signedUpCombatTrialHrid: "badger", signedUpCombatRoleHrid: "tank",
        signupWeekStartAt: weekStart - 7 * Core.DAY_MS,
    }], profiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook"], combatHrids: ["badger"] },
        trialDetails: { cook: { skillHrid: "/skills/cooking" }, badger: { name: "Badger" } },
        guildWeekStartAt: weekStart,
    });
    const csv = Core.toCsv(aggregate, {}, {}, {}, [], weekStart);
    const row = csv.split("\r\n")[1].split(",");

    assert.equal(Core.isCurrentSignup(aggregate.members[0], weekStart), false);
    assert.equal(analysis.anyTrialSignedCount, 0);
    assert.deepEqual(analysis.unsignedTrials.map((member) => member.name), ["Ada"]);
    assert.deepEqual(row.slice(8, 11), ["", "", ""]);
});

test("includes offline and prior-week status in CSV exports", () => {
    const aggregate = Core.aggregateGuild([roster[1]], profiles);
    const csv = Core.toCsv(aggregate, {}, {}, {}, [{
        memberId: "2",
        offlineDurationMs: 4 * Core.DAY_MS,
        offlineThreeDays: true,
        previousWeekStatus: "missed",
    }]);

    assert.match(csv, /Offline Days,Offline 3\+ Days,Previous Week Trial/);
    assert.match(csv, /4\.0,Yes,No signup/);
});

test("ranks guild-credit conversions and prices shrine levels", () => {
    const economy = Core.analyzeGuildEconomy({
        itemDetails: {
            "/items/apple": {
                name: "Apple",
                guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 10, creditCount: 5 }],
            },
            "/items/log": {
                name: "Log",
                guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 4, creditCount: 4 }],
            },
            "/items/gem": {
                name: "Gem",
                guildCreditConversions: [{ creditItemHrid: "/items/purple_credit", itemCount: 2, creditCount: 1 }],
            },
            "/items/green_credit": { name: "Green Guild Credit" },
            "/items/purple_credit": { name: "Purple Guild Credit" },
            "/items/guild_token": {
                name: "Guild Token",
                guildCreditConversions: [
                    { creditItemHrid: "/items/green_credit", guildTokenCount: 1, creditCount: 10 },
                    { creditItemHrid: "/items/purple_credit", guildTokenCount: 1, creditCount: 2 },
                ],
            },
        },
        marketData: {
            marketData: {
                "/items/apple": { 0: { a: 20, b: 18 } },
                "/items/log": { 0: { a: 30, b: 28 } },
                "/items/gem": { 0: { a: 50, b: 45 } },
            },
        },
        guildBuffDetails: {
            "/guild_buffs/force": {
                name: "Force Shrine",
                isCombat: true,
                levelCosts: [
                    null,
                    { guildTokenCost: 2, creditCosts: [{ itemHrid: "/items/green_credit", count: 3 }] },
                    { guildTokenCost: 0, creditCosts: [{ itemHrid: "/items/purple_credit", count: 4 }] },
                ],
            },
        },
        guildBuffLevels: { "/guild_buffs/force": 1 },
    });
    const green = economy.credits.find((credit) => credit.creditHrid === "/items/green_credit");
    const force = economy.shrines[0];

    assert.equal(green.bestOption.itemName, "Log");
    assert.equal(green.bestOption.costPerCredit, 30);
    assert.equal(economy.creditValues["/items/purple_credit"], 100);
    assert.equal(economy.guildTokenValue, 300);
    assert.equal(force.currentLevel, 1);
    assert.equal(force.levels[0].incrementalCost, 690);
    assert.equal(force.levels[0].purchased, true);
    assert.equal(force.levels[1].incrementalCost, 400);
    assert.equal(force.levels[1].cumulativeCost, 1090);
});

test("uses ask, fair, then bid prices and leaves unknown shrine costs unpriced", () => {
    const marketData = { marketData: {
        "/items/ask": { 0: { a: 40, p: 35, b: 30 } },
        "/items/fair": { 0: { a: -1, p: 25, b: 20 } },
        "/items/bid": { 0: { a: -1, b: 15 } },
    } };
    assert.deepEqual(["ask", "fair", "bid"].map((name) => Core.getMarketQuote(`/items/${name}`, marketData).source), ["ask", "fair", "bid"]);

    const economy = Core.analyzeGuildEconomy({
        itemDetails: {
            "/items/ask": { guildCreditConversions: [{ creditItemHrid: "/items/credit", itemCount: 1, creditCount: 1 }] },
            "/items/credit": { name: "Credit" },
        },
        guildBuffDetails: {
            "/guild_buffs/test": { levelCosts: [null, { creditCosts: [{ itemHrid: "/items/unknown_credit", count: 2 }] }] },
        },
        marketData,
    });
    assert.equal(economy.credits[0].bestOption.costPerCredit, 40);
    assert.equal(economy.shrines[0].levels[0].incrementalCost, null);
    assert.equal(economy.pricedLevelCount, 0);
});

test("finds nested guild buff levels", () => {
    const levels = Core.extractGuildBuffLevels({
        guild: { characterGuildBuffMap: { "/guild_buffs/force": { level: 3 } } },
    });
    const economy = Core.analyzeGuildEconomy({
        guildBuffDetails: { "/guild_buffs/force": { levelCosts: [null, { guildTokenCost: 1 }] } },
        guildBuffLevels: levels,
    });
    assert.equal(economy.shrines[0].currentLevel, 3);
    assert.equal(economy.shrines[0].levels[0].purchased, true);
});

test("groups combat and skilling buffs by shrine family", () => {
    const economy = Core.analyzeGuildEconomy({
        guildBuffDetails: {
            "/guild_buffs/force_combat": { levelCosts: [null, { guildTokenCost: 0 }] },
            "/guild_buffs/force_skilling": { levelCosts: [null, { guildTokenCost: 0 }] },
            "/guild_buffs/tempo_skilling": {
                guildShrineHrid: "/guild_shrines/tempo",
                levelCosts: [null, { guildTokenCost: 0 }],
            },
        },
        guildBuffLevels: {
            "/guild_buffs/force_combat": 2,
            "/guild_buffs/force_skilling": 1,
        },
    });

    assert.deepEqual(economy.shrineGroups.map((group) => group.name), ["Force Shrine", "Tempo Shrine"]);
    assert.deepEqual(economy.shrineGroups[0].buffs.map((buff) => buff.guildBuffHrid), [
        "/guild_buffs/force_combat",
        "/guild_buffs/force_skilling",
    ]);
    assert.deepEqual(economy.shrineGroups[0].buffs.map((buff) => buff.currentLevel), [2, 1]);
    assert.equal(economy.shrineGroups[0].levelCount, 2);
    assert.equal(economy.shrineGroups[0].pricedLevelCount, 2);
});

test("orders shrines Force, Tempo, Spirit, Rarity, Scholar in both views", () => {
    const order = ["force", "tempo", "spirit", "rarity", "scholar"];
    const scrambled = ["scholar", "rarity", "spirit", "tempo", "force"];
    const shrineDetails = Object.fromEntries(scrambled.map((name, index) => [
        `/guild_shrines/${name}`,
        { maxLevel: 20, sortIndex: index, guildPointCosts: { 1: 10 } },
    ]));
    const guildBuffDetails = Object.fromEntries(scrambled.map((name) => [
        `/guild_buffs/${name}_combat`,
        { guildShrineHrid: `/guild_shrines/${name}`, levelCosts: [null, { guildTokenCost: 1 }] },
    ]));

    const structures = Core.analyzeGuildStructures({ guildPoints: 100 }, {}, {}, shrineDetails);
    const economy = Core.analyzeGuildEconomy({ guildBuffDetails });
    assert.deepEqual(structures.shrines.map((shrine) => shrine.hrid.split("/").pop()), order);
    assert.deepEqual(economy.shrineGroups.map((group) => group.shrineTypeHrid.split("/").pop()), order);
});

test("orders guild buildings as shown in the game", () => {
    const order = [
        "guild_hall", "builders_hall", "treasury", "archives",
        "skilling_encampment", "combat_encampment", "dairy_barn", "garden",
        "log_shed", "forge", "workshop", "sewing_parlor",
        "kitchen", "brewery", "laboratory", "observatory",
        "dining_room", "library", "dojo", "armory",
        "gym", "archery_range", "mystical_study",
    ];
    const details = Object.fromEntries(["future_building", ...order].reverse().map((name, index) => [
        `/guild_buildings/${name}`,
        { sortIndex: index, maxLevel: 20, guildPointCosts: { 1: 10 } },
    ]));
    const structures = Core.analyzeGuildStructures({ guildPoints: 100 }, {}, details);
    assert.deepEqual(structures.buildings.map((building) => building.hrid.split("/").pop()), [...order, "future_building"]);
});

test("extracts economy definitions from cached and wrapped client payloads", () => {
    const definitions = Core.extractEconomyDefinitions(JSON.stringify({
        data: {
            initClientData: {
                itemDetailMap: {},
                itemDetailDict: { "/items/apple": { guildCreditConversions: [] } },
                guildBuffDetailMap: {},
                guildBuffDetailDict: { "/guild_buffs/force": { levelCosts: [null, {}] } },
                guildBuildingDetailMap: { "/guild_buildings/guild_hall": { guildPointCosts: { 1: 100 } } },
                guildShrineDetailMap: { "/guild_shrines/force": { guildPointCosts: { 1: 50 } } },
                leaderboardTypeDetailMap: { guild: { isGuild: true } },
            },
        },
    }));
    assert.ok(definitions.itemDetails["/items/apple"]);
    assert.ok(definitions.guildBuffDetails["/guild_buffs/force"]);
    assert.ok(definitions.guildBuildingDetails["/guild_buildings/guild_hall"]);
    assert.ok(definitions.guildShrineDetails["/guild_shrines/force"]);
    assert.equal(definitions.leaderboardTypeDetails.guild.isGuild, true);
});

test("suggests first and second trial skills relative to guild medians", () => {
    const members = [
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Babbage", signedUpSkillingTrialHrid: "mine" },
        { id: "3", name: "Curie", signedUpSkillingTrialHrid: "" },
    ];
    const memberProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 150 }, { skillHrid: "/skills/mining", level: 100 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 100 }, { skillHrid: "/skills/mining", level: 150 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 120 }, { skillHrid: "/skills/mining", level: 120 }] },
    };
    const aggregate = Core.aggregateGuild(members, memberProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            mine: { skillHrid: "/skills/mining" },
        },
    });
    const ada = analysis.medianSuggestions.find((entry) => entry.memberName === "Ada");
    const babbage = analysis.medianSuggestions.find((entry) => entry.memberName === "Babbage");

    assert.equal(aggregate.skills.find((skill) => skill.skillHrid === "/skills/cooking").median, 120);
    assert.equal(ada.first.trialHrid, "cook");
    assert.equal(ada.first.medianDifference, 30);
    assert.equal(ada.second.trialHrid, "mine");
    assert.equal(babbage.first.trialHrid, "mine");
    assert.equal(babbage.second.trialHrid, "cook");
});
