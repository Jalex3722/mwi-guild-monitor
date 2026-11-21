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

test("orders skills as shown in the game and keeps unlisted skills last", () => {
    const order = [
        "milking", "foraging", "woodcutting", "cheesesmithing", "crafting", "tailoring",
        "cooking", "brewing", "alchemy", "enhancing", "combat", "stamina",
        "intelligence", "attack", "defense", "melee", "ranged", "magic",
    ];
    const skills = [...order, "mining", "labyrinth", "total_level"].reverse().map((name) => ({
        skillHrid: `/skills/${name}`,
        name: Core.prettifyHrid(name),
    }));
    skills.sort(Core.compareSkillsByDisplayOrder);
    assert.deepEqual(skills.map((skill) => skill.skillHrid.split("/").pop()), ["total_level", ...order, "labyrinth", "mining"]);
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

test("captures profile combat level alongside character skills", () => {
    const profile = Core.normalizeProfile({
        sharableCharacter: { id: 7, name: "Grace", combatLevel: 106 },
        combatLevel: 115,
        characterSkills: [
            { skillHrid: "/skills/foraging", level: 72, experience: 123 },
            { skillHrid: "/skills/combat", level: 99, experience: 0 },
        ],
    }, 5000);
    const combat = profile.skills.filter((skill) => skill.skillHrid === "/skills/combat");
    const aggregate = Core.aggregateGuild([{ id: "7", name: "Grace" }], { 7: profile });

    assert.equal(combat.length, 1);
    assert.equal(combat[0].level, 115);
    assert.equal(aggregate.skills.find((skill) => skill.skillHrid === "/skills/combat").average, 115);
    assert.equal(Core.getEffectiveAuraAssignment({}, aggregate.members[0]), "/abilities/insanity");
});

test("uses nested profile combat level when it is not listed as a skill", () => {
    const profile = Core.normalizeProfile({
        sharableCharacter: { id: 8, name: "Hopper", combatLevel: "109" },
        characterSkills: [{ skillHrid: "/skills/cooking", level: 80 }],
    });
    const missing = Core.normalizeProfile({
        sharableCharacter: { id: 9, name: "Turing", combatLevel: "unknown" },
        characterSkills: [{ skillHrid: "/skills/cooking", level: 85 }],
    });

    assert.equal(profile.skills.find((skill) => skill.skillHrid === "/skills/combat").level, 109);
    assert.equal(missing.skills.some((skill) => skill.skillHrid === "/skills/combat"), false);
    assert.equal(Core.normalizeProfile({
        sharableCharacter: { id: 10, name: "Lovelace" },
        combatLevel: 120,
        characterSkills: [],
    }), null);
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
    assert.equal(Core.getWeeklyTrialPointsTotal(second[week].results), 180);
    const afterSignupObservation = Core.recordWeeklyTrialParticipation(second, Core.aggregateGuild([
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
    ], {}), week, week + 3000);
    assert.equal(afterSignupObservation[week].results.cook.highestTier, 3);
});

test("totals only observed weekly trial points", () => {
    const results = {
        cook: { status: "completed", points: 120 },
        badger: { status: "in_progress", points: "80" },
        mining: { status: "scheduled", points: 500 },
        swarm: { status: "completed" },
    };
    assert.equal(Core.getWeeklyTrialPointsTotal(results), 200);
    assert.equal(Core.getTrialResultPoints(results.mining), null);
    assert.equal(Core.getWeeklyTrialPointsTotal({ mining: results.mining, swarm: results.swarm }), null);
    assert.equal(Core.getWeeklyTrialPointsTotal({ cook: { status: "completed", points: 0 } }), 0);
});

test("tracks high-level thresholds alongside trial signup status", () => {
    const highLevelRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpSkillingTrialHrid: "cook", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", role: "officer", signedUpSkillingTrialHrid: "mine", signedUpCombatTrialHrid: "" },
        { id: "3", name: "Curie", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "" },
    ];
    const highLevelProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 151 }, { skillHrid: "/skills/foraging", level: 150 }] },
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

    assert.equal(cooking.thresholdCounts[100].count, 4);
    assert.equal(cooking.thresholdCounts[125].count, 3);
    assert.equal(cooking.thresholdCounts[150].count, 1);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
    assert.deepEqual(analysis.unsignedTrials.map((member) => member.name), ["Noether"]);
    assert.deepEqual(analysis.recommendations.map((entry) => entry.memberName).sort(), ["Ada", "Babbage", "Curie", "Noether"]);
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Curie").signupStatus, "combatOnly");
    assert.equal(analysis.memberComparisons.find((entry) => entry.memberName === "Noether").signupStatus, "unsigned");
    assert.deepEqual(analysis.missingRecommendedSignup.map((entry) => entry.memberName).sort(), ["Curie", "Noether"]);
    assert.deepEqual(analysis.wrongRecommendedSignup.map((entry) => entry.memberName), ["Babbage"]);
    assert.equal(analysis.wrongRecommendedSignup[0].currentTrialName, "Mine");
    assert.equal(analysis.optimalDistribution[0].assignments.length, 4);
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
});

test("treats the game trial level as information, not a signup requirement", () => {
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
        trialMinLevels: JSON.stringify({ cook: 180, mine: 250 }),
    });
    assert.deepEqual(analysis.skilling.map((trial) => trial.reportedLevel), [180, 250]);
    assert.equal(analysis.recommendations.length, 2, "nobody is excluded by the reported trial level");
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

test("compares an icon goal's credit exchange with the cheapest priced item", () => {
    const itemDetails = {
        "/items/apple": { name: "Apple", guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 10, creditCount: 5 }] },
        "/items/log": { name: "Log", guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 4, creditCount: 4 }] },
        "/items/unpriced": { name: "Unpriced", guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 2, creditCount: 1 }] },
        "/items/green_credit": { name: "Green Guild Credit" },
    };
    const marketData = { marketData: {
        "/items/apple": { 0: { a: 20 } },
        "/items/log": { 0: { a: 30 } },
    } };
    const analyze = (iconTargetItemHrid) => Core.analyzeGuildEconomy({ itemDetails, marketData, iconTargetItemHrid });

    const target = analyze("/items/apple").iconTarget;
    assert.equal(target.option.itemCount, 10);
    assert.equal(target.option.creditCount, 5);
    assert.equal(target.option.costPerCredit, 40);
    assert.equal(target.bestOption.itemName, "Log");
    assert.equal(target.extraCoinsPerCredit, 10);
    assert.ok(Math.abs(target.extraPercent - 100 / 3) < 0.001);
    assert.equal(analyze("/items/log").iconTarget.extraCoinsPerCredit, 0);
    assert.equal(analyze("/items/unpriced").iconTarget.extraCoinsPerCredit, null);
    assert.equal(analyze("/items/missing").iconTarget, null);
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

test("builds a polite trial reminder whisper for a member name", () => {
    const whisper = Core.buildTrialReminderWhisper("Babbage");
    assert.equal(whisper, `/w Babbage ${Core.TRIAL_REMINDER_MESSAGE}`);
    assert.match(Core.TRIAL_REMINDER_MESSAGE, /sign up/i);
    assert.match(Core.TRIAL_REMINDER_MESSAGE, /trial/i);
    assert.doesNotMatch(Core.TRIAL_REMINDER_MESSAGE, /[\r\n]/);
    assert.equal(Core.buildTrialReminderWhisper("  Curie "), `/w Curie ${Core.TRIAL_REMINDER_MESSAGE}`);
});

test("refuses trial reminder whispers for names that would break the command", () => {
    assert.equal(Core.buildTrialReminderWhisper(""), null);
    assert.equal(Core.buildTrialReminderWhisper(null), null);
    assert.equal(Core.buildTrialReminderWhisper("Two Words"), null);
    assert.equal(Core.buildTrialReminderWhisper("Line\nBreak"), null);
});

test("keeps the release version identical in every published location", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(__dirname, "..");
    const source = fs.readFileSync(path.join(root, "mwi-guild-monitor.user.js"), "utf8");
    const version = require("../package.json").version;
    assert.equal(source.match(/^\/\/ @version\s+(\S+)$/m)[1], version);
    assert.equal(source.match(/const SCRIPT_VERSION = "([^"]+)"/)[1], version);
    assert.ok(fs.readFileSync(path.join(root, "README.md"), "utf8").includes(`The current release is \`v${version}\`.`));
    const raw = "https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js";
    const metadata = (key) => source.match(new RegExp(`^// @${key}[ \\t]+(\\S+)[ \\t]*\\r?$`, "m"))?.[1];
    assert.equal(metadata("updateURL"), raw);
    assert.equal(metadata("downloadURL"), raw);
});

test("scrolls wide tables inside their own containers on narrow screens", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync(require.resolve("../mwi-guild-monitor.user.js"), "utf8");
    assert.match(source, /content\.innerHTML = [^;]*renderContent\(aggregate\);\s*wrapWideTables\(content\);/);
    const narrowRules = source.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\s*\}\n/);
    assert.ok(narrowRules, "expected a narrow-screen table rule block");
    assert.match(narrowRules[1], /\.mwigm-table-scroll \{[^}]*overflow-x: auto/);
    assert.match(narrowRules[1], /:first-child:not\(\[colspan\]\) \{[^}]*position: sticky; left: 0/);
});

test("resolves the guild trial start and opens reminders only in the final 24 hours", () => {
    const weekStart = Date.UTC(2026, 10, 13); // Friday 00:00 UTC
    const hour = 3_600_000;
    const guild = { currentWeekStartAt: weekStart, trialScheduleHourOffset: 21 };

    const early = Core.resolveTrialSchedule(guild, null, Date.UTC(2026, 10, 17, 12));
    assert.equal(early.known, true);
    assert.equal(early.startAt, Date.UTC(2026, 10, 20, 21), "a past start rolls to next week's");
    assert.equal(early.remindersOpen, false);
    assert.equal(early.reminderOpensAt, Date.UTC(2026, 10, 20), "never before that trial's week begins");

    const sameDay = Core.resolveTrialSchedule(guild, null, weekStart + 10 * hour);
    assert.equal(sameDay.startAt, weekStart + 21 * hour);
    assert.equal(sameDay.remindersOpen, true);
    assert.equal(sameDay.inProgress, false);

    const running = Core.resolveTrialSchedule(guild, null, weekStart + 21.5 * hour);
    assert.equal(running.inProgress, true);
    assert.equal(running.remindersOpen, false);

    const finished = Core.resolveTrialSchedule(guild, null, weekStart + 23.5 * hour);
    assert.equal(finished.startAt, weekStart + 7 * 86_400_000 + 21 * hour);
    assert.equal(finished.remindersOpen, false);
});

test("reads the trial start hour from the guild or update message and rejects bad values", () => {
    const weekStart = Date.UTC(2026, 10, 13);
    const now = weekStart + 3_600_000;
    const midnight = Core.resolveTrialSchedule({ currentWeekStartAt: weekStart }, "0", now);
    assert.equal(midnight.startAt, weekStart, "0 is a real offset: the week's own midnight");
    assert.equal(midnight.inProgress, true);
    assert.equal(Core.resolveTrialSchedule({ currentWeekStartAt: weekStart, trialScheduleHourOffset: 5 }, 9, now).hourOffset, 5);
    assert.equal(Core.resolveTrialSchedule({ currentWeekStartAt: weekStart }, 9, now).hourOffset, 9);
    for (const bad of [24, -1, 2.5, "", null, undefined, "noon"]) {
        const schedule = Core.resolveTrialSchedule({ currentWeekStartAt: weekStart }, bad, now);
        assert.equal(schedule.known, false, String(bad));
        assert.equal(schedule.remindersOpen, true, "unknown start keeps the previous always-visible behavior");
    }
});

test("builds the guild recruitment message with the guild chat link", () => {
    const message = Core.buildRecruitMessage();
    assert.equal(Core.GUILD_CHAT_LINK, "[g@]");
    assert.ok(message.startsWith(`${Core.GUILD_CHAT_LINK} `), "leads with the guild tag");
    assert.equal(message.split(Core.GUILD_CHAT_LINK).length - 1, 1);
    assert.match(message, /looking for YOU/);
    assert.match(message, /top 30 guild in Guild Points/);
    assert.match(message, /relaxed requirements/);
    assert.match(message, /online and signing up for trials/);
    assert.ok(message.endsWith("Hope you apply! :)"));
    assert.ok(!/[\r\n]/.test(message));
    assert.ok(message.length <= 240, `length ${message.length}`);
});

test("records guild exp samples and measures exp per hour", () => {
    const hour = 3_600_000;
    let history = Core.recordGuildExperienceHistory([], { level: 10, experience: 1000, updatedAt: new Date(0).toISOString() }, 999);
    assert.deepEqual(history, [{ level: 10, experience: 1000, observedAt: 0 }]);
    const same = Core.recordGuildExperienceHistory(history, { level: 10, experience: 1000, updatedAt: new Date(0).toISOString() }, 5);
    assert.equal(same, history, "an unchanged guild leaves the stored array untouched");
    assert.equal(Core.recordGuildExperienceHistory(history, { level: 10 }, 5), history);
    assert.equal(Core.estimateGuildExperienceRate(history), null);
    history = Core.recordGuildExperienceHistory(history, { level: 10, experience: 1100, updatedAt: new Date(hour / 2).toISOString() }, 1);
    history = Core.recordGuildExperienceHistory(history, { level: 10, experience: 1150, updatedAt: new Date(hour / 2 + 60_000).toISOString() }, 1);
    history = Core.recordGuildExperienceHistory(history, { level: 10, experience: 1160, updatedAt: new Date(hour / 2 + 120_000).toISOString() }, 1);
    assert.equal(history.length, 3, "a sample under 5 minutes after the one before it is replaced");
    assert.equal(history[2].experience, 1160);
    history = Core.recordGuildExperienceHistory(history, { level: 11, experience: 3000, updatedAt: new Date(2 * hour).toISOString() }, 1);
    const rate = Core.estimateGuildExperienceRate(history);
    assert.equal(rate.perHour, 1000);
    assert.equal(rate.spanMs, 2 * hour);
    const late = Core.recordGuildExperienceHistory(history, { level: 11, experience: 9000, updatedAt: new Date(30 * hour).toISOString() }, 1);
    assert.equal(Core.estimateGuildExperienceRate(late), null, "older samples outside the 24-hour window are ignored");
    const backwards = Core.recordGuildExperienceHistory(history, { level: 11, experience: 3500, updatedAt: new Date(hour).toISOString() }, 1);
    assert.equal(backwards, history, "older updates are ignored");
});

test("analyzes guild level progress and the next member slot", () => {
    const table = [0, 0, 100, 300, 600, 1000, 1500, 2100];
    const info = Core.analyzeGuildLevel({ level: 4, experience: 800 }, table, { perHour: 100 });
    assert.equal(Core.GUILD_LEVELS_PER_MEMBER_SLOT, 3);
    assert.equal(info.level, 4);
    assert.equal(info.progress, 0.5);
    assert.equal(info.nextLevel, 5);
    assert.equal(info.expToNextLevel, 200);
    assert.equal(info.hoursToNextLevel, 2);
    assert.equal(info.nextSlotLevel, 6);
    assert.equal(info.expToNextSlot, 700);
    assert.equal(info.hoursToNextSlot, 7);
    assert.equal(Core.analyzeGuildLevel({ level: 3, experience: 300 }, table).nextSlotLevel, 6, "a slot level already reached points at the next one");
    assert.equal(Core.analyzeGuildLevel({ level: 5, experience: 1200 }, table).nextSlotLevel, 6);
    const unknownRate = Core.analyzeGuildLevel({ level: 4, experience: 800 }, table, null);
    assert.equal(unknownRate.perHour, null);
    assert.equal(unknownRate.hoursToNextSlot, null);
    const noTable = Core.analyzeGuildLevel({ level: 4, experience: 800 }, []);
    assert.equal(noTable.expToNextSlot, null);
    assert.equal(noTable.progress, null);
    assert.equal(Core.analyzeGuildLevel(null, table).level, null);
    assert.deepEqual(Core.extractEconomyDefinitions({ initClientData: { levelExperienceTable: table } }).levelExperienceTable, table);
});

test("treats the game's leftover whisper prefix as an empty chat draft", () => {
    for (const draft of ["", "/w Ada", "/w Ada ", "/W Babbage  ", "/whisper Curie "]) {
        assert.equal(Core.isReplaceableChatDraft(draft), true, JSON.stringify(draft));
    }
    for (const draft of [" ", "/w Ada hi", "/w Ada  see you at trials", "/w ", "/profile Ada", "hello", "/w Ada\nhi"]) {
        assert.equal(Core.isReplaceableChatDraft(draft), false, JSON.stringify(draft));
    }
    assert.equal(Core.isReplaceableChatDraft(null), true);
});

// Builds a guild with captured profiles plus optional "ghost" members (no profile) signed up for a
// trial. Ghosts keep their slots, which shrinks the plan's capacity: each skilling trial has 20 slots
// at skilling encampment level 0.
function planFixture(levels, { trialHrids = ["cook", "mine", "brew", "wood"], signups = [], combat = [], ghosts = {} } = {}) {
    const skillHrids = ["/skills/cooking", "/skills/mining", "/skills/brewing", "/skills/woodcutting"].slice(0, trialHrids.length);
    const roster = levels.map((_, index) => ({
        id: String(index + 1),
        name: `Member ${index + 1}`,
        signedUpSkillingTrialHrid: signups[index] || "",
        signedUpCombatTrialHrid: combat[index] || "",
    }));
    Object.entries(ghosts).forEach(([trialHrid, count]) => {
        for (let index = 0; index < count; index += 1) {
            roster.push({ id: `ghost-${trialHrid}-${index}`, name: `Ghost ${trialHrid} ${index}`, signedUpSkillingTrialHrid: trialHrid });
        }
    });
    const profiles = Object.fromEntries(levels.map((row, index) => [String(index + 1), {
        id: String(index + 1), name: `Member ${index + 1}`, capturedAt: 1,
        skills: skillHrids.map((skillHrid, skill) => ({ skillHrid, level: row[skill] })),
    }]));
    const analysis = Core.analyzeTrials({
        aggregate: Core.aggregateGuild(roster, profiles),
        weeklyTrialSet: { skillHrids: trialHrids, combatHrids: [] },
        trialDetails: Object.fromEntries(trialHrids.map((hrid, index) => [hrid, { skillHrid: skillHrids[index] }])),
    });
    const choiceOf = (index) => trialHrids.indexOf(analysis.recommendations.find((entry) => entry.memberId === String(index + 1)).recommendedTrialHrid);
    return { analysis, choices: levels.map((_, index) => choiceOf(index)) };
}

test("Hungarian solver finds the minimum-cost assignment on rectangular matrices", () => {
    assert.deepEqual(Core.solveAssignment([]), []);
    assert.deepEqual(Core.solveAssignment([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) % 50;
    for (let fixture = 0; fixture < 40; fixture += 1) {
        const rows = 1 + (fixture % 4);
        const columns = rows + (fixture % 3);
        const costs = Array.from({ length: rows }, () => Array.from({ length: columns }, random));
        const chosen = Core.solveAssignment(costs);
        assert.equal(new Set(chosen).size, rows, "each column used once");
        const total = chosen.reduce((sum, column, row) => sum + costs[row][column], 0);
        let best = Infinity;
        const search = (row, used, sum) => {
            if (row === rows) { best = Math.min(best, sum); return; }
            for (let column = 0; column < columns; column += 1) {
                if (!used.has(column)) { used.add(column); search(row + 1, used, sum + costs[row][column]); used.delete(column); }
            }
        };
        search(0, new Set(), 0);
        assert.equal(total, best, `fixture ${fixture}`);
    }
});

test("skilling plan puts each member in their highest skill when slots are plentiful", () => {
    const { analysis, choices } = planFixture([
        [150, 90, 90, 90],
        [140, 100, 90, 90],
        [130, 120, 90, 90],
        [90, 90, 90, 160],
    ]);
    assert.deepEqual(choices, [0, 0, 0, 3], "no forced balancing: members strongest in Cooking all go to Cooking");
    assert.equal(analysis.plannedTotalLevel, 150 + 140 + 130 + 160);
    assert.equal(analysis.optimalDistribution.find((trial) => trial.trialHrid === "cook").targetTotalLevel, 420);
    assert.deepEqual(analysis.noSlotRecommendations, []);
});

test("skilling plan maximizes the total level under slot caps (brute force check)", () => {
    const trialHrids = ["cook", "mine", "brew"];
    let seed = 311;
    const random = () => ((seed = (seed * 48271) % 2147483647) % 80) + 60;
    for (let fixture = 0; fixture < 12; fixture += 1) {
        const levels = Array.from({ length: 6 }, () => trialHrids.map(random));
        // 18 ghosts in Cooking and 19 in Mining leave 2 and 1 open slots; Brewing keeps 20.
        const caps = [2, 1, 20];
        const { analysis, choices } = planFixture(levels, { trialHrids, ghosts: { cook: 18, mine: 19 } });
        assert.deepEqual(analysis.optimalDistribution.map((trial) => trial.planCapacity), caps);
        trialHrids.forEach((_, trial) => assert.ok(choices.filter((choice) => choice === trial).length <= caps[trial]));
        let best = -Infinity;
        for (let encoded = 0; encoded < 3 ** levels.length; encoded += 1) {
            let remaining = encoded;
            const option = levels.map(() => { const choice = remaining % 3; remaining = Math.floor(remaining / 3); return choice; });
            if (trialHrids.some((_, trial) => option.filter((choice) => choice === trial).length > caps[trial])) continue;
            best = Math.max(best, option.reduce((sum, choice, member) => sum + levels[member][choice], 0));
        }
        const total = choices.reduce((sum, choice, member) => sum + levels[member][choice], 0);
        assert.equal(total, best, `fixture ${fixture}`);
        assert.equal(analysis.plannedTotalLevel, best);
    }
});

test("skilling plan reports members who cannot get any open slot", () => {
    // One open Cooking slot and nothing else this week: the higher level member gets it.
    const { analysis } = planFixture([[120], [150]], { trialHrids: ["cook"], ghosts: { cook: 19 } });
    const byName = Object.fromEntries(analysis.recommendations.map((entry) => [entry.memberName, entry]));
    assert.equal(byName["Member 2"].recommendedTrialName, "Cooking");
    assert.equal(byName["Member 1"].signupStatus, "noSlot");
    assert.equal(byName["Member 1"].recommendedTrialHrid, "");
    assert.deepEqual(analysis.noSlotRecommendations.map((entry) => entry.memberName), ["Member 1"]);
    assert.equal(analysis.plannedTotalLevel, 150);
});

test("skilling plan flags right spot, wrong trial, combat only and not signed up", () => {
    const { analysis } = planFixture([
        [150, 90, 90, 90],
        [90, 150, 90, 90],
        [90, 90, 150, 90],
        [90, 90, 90, 150],
    ], { signups: ["cook", "cook", "", ""], combat: ["", "", "badger", ""] });
    const status = Object.fromEntries(analysis.recommendations.map((entry) => [entry.memberName, entry.signupStatus]));
    assert.deepEqual(status, { "Member 1": "aligned", "Member 2": "different", "Member 3": "combatOnly", "Member 4": "unsigned" });
    assert.equal(analysis.recommendations.find((entry) => entry.memberName === "Member 2").recommendedTrialName, "Mining");
    assert.deepEqual(analysis.wrongRecommendedSignup.map((entry) => entry.memberName), ["Member 2"]);
    assert.deepEqual(analysis.missingRecommendedSignup.map((entry) => entry.memberName).sort(), ["Member 3", "Member 4"]);
    assert.equal(analysis.currentTotalLevel, 150 + 90);
    assert.equal(analysis.plannedTotalLevel, 600);
});

test("skilling plan keeps current signups on exact ties", () => {
    const levels = [[100, 100, 100, 100], [100, 100, 100, 100], [120, 100, 100, 100]];
    const { analysis, choices } = planFixture(levels, { signups: ["mine", "wood", "brew"] });
    assert.deepEqual(choices, [1, 3, 0]);
    assert.deepEqual(analysis.recommendations.filter((entry) => entry.isAligned).map((entry) => entry.memberName).sort(), ["Member 1", "Member 2"]);
});

test("skilling plan solves a full-size guild quickly", () => {
    let seed = 99;
    const random = () => ((seed = (seed * 48271) % 2147483647) % 120) + 80;
    const levels = Array.from({ length: 60 }, () => [random(), random(), random(), random()]);
    const started = Date.now();
    const { analysis } = planFixture(levels);
    assert.equal(analysis.recommendations.length, 60);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
});
